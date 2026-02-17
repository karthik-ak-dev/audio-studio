/**
 * socket/recording.ts — Recording start/stop controls via Socket.IO.
 *
 * Handles the recording lifecycle for a meeting room.
 * Only the HOST can start/stop recording — guests receive the broadcast
 * but cannot initiate or halt a recording session.
 *
 *   START_RECORDING:
 *     1. Validates the sender is the host (rejects guests)
 *     2. Generates a new UUID sessionId (groups the host + guest recordings together)
 *     3. Persists the recording state in DynamoDB (RecordingState table)
 *     4. Broadcasts START_RECORDING to all participants (they begin capturing audio)
 *     5. Updates the meeting status to 'recording' and increments global stats
 *
 *   STOP_RECORDING:
 *     1. Validates the sender is the host (rejects guests)
 *     2. Updates RecordingState.isRecording → false, sets stoppedAt timestamp
 *     3. Broadcasts STOP_RECORDING to all participants (they stop capturing)
 *     4. Reverts the meeting status back to 'active' and decrements global stats
 *
 * The sessionId is critical — it's sent to clients who then include it when
 * uploading their recording files, linking the host and guest audio together.
 *
 * Only one recording can be active per meeting at a time (enforced by the
 * singleton RecordingState per meetingId).
 */
import { v4 as uuid } from 'uuid';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS, ROLES, MEETING_STATUS } from '../shared';
import * as recordingStateRepo from '../repositories/recordingStateRepo';
import * as meetingService from '../services/meetingService';
import * as statsRepo from '../repositories/statsRepo';
import { logger } from '../utils/logger';

export function handleRecording(io: SocketIOServer, socket: Socket): void {
  // ─── Start Recording ─────────────────────────────────────────
  socket.on(SOCKET_EVENTS.START_RECORDING, async ({ roomId }) => {
    try {
      if (!roomId) return;

      // Only the host can start recording
      if (socket.userRole !== ROLES.HOST) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Only the host can start recording' });
        return;
      }

      // Generate a unique session ID that groups host + guest recordings
      const sessionId = uuid();

      // Persist recording state (who started it, when, session ID)
      await recordingStateRepo.startRecording(
        roomId,
        sessionId,
        socket.id,
        socket.userId || '',
      );

      logger.info('Recording started', { roomId, sessionId });

      // Broadcast to all participants — clients start capturing audio locally
      io.to(roomId).emit(SOCKET_EVENTS.START_RECORDING, { sessionId });

      // Update meeting lifecycle status and global dashboard counters
      await meetingService.updateStatus(roomId, MEETING_STATUS.RECORDING);
      await statsRepo.incrementActiveRecording();
    } catch (err) {
      logger.error('Error starting recording', {
        roomId,
        socketId: socket.id,
        error: (err as Error).message,
      });
      socket.emit(SOCKET_EVENTS.ERROR, {
        message: `Failed to start recording: ${(err as Error).message}`,
      });
    }
  });

  // ─── Stop Recording ──────────────────────────────────────────
  socket.on(SOCKET_EVENTS.STOP_RECORDING, async ({ roomId }) => {
    try {
      if (!roomId) return;

      // Only the host can stop recording
      if (socket.userRole !== ROLES.HOST) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Only the host can stop recording' });
        return;
      }

      // Mark recording as stopped in DynamoDB (sets stoppedAt, clears isRecording)
      await recordingStateRepo.stopRecording(roomId);
      logger.info('Recording stopped', { roomId });

      // Broadcast to all participants — clients stop capturing and begin upload
      io.to(roomId).emit(SOCKET_EVENTS.STOP_RECORDING, {});

      // Revert meeting status back to 'active' and update dashboard counters
      await meetingService.updateStatus(roomId, MEETING_STATUS.ACTIVE);
      await statsRepo.decrementActiveRecording();
    } catch (err) {
      logger.error('Error stopping recording', {
        roomId,
        socketId: socket.id,
        error: (err as Error).message,
      });
      socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to stop recording' });
    }
  });
}
