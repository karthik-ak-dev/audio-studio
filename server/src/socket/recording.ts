import { v4 as uuid } from 'uuid';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../shared';
import * as recordingStateRepo from '../repositories/recordingStateRepo';
import * as meetingService from '../services/meetingService';
import * as statsRepo from '../repositories/statsRepo';
import { logger } from '../utils/logger';

export function handleRecording(io: SocketIOServer, socket: Socket): void {
  socket.on(SOCKET_EVENTS.START_RECORDING, async ({ roomId }) => {
    try {
      if (!roomId) return;

      const sessionId = uuid();
      await recordingStateRepo.startRecording(
        roomId,
        sessionId,
        socket.id,
        socket.userId || '',
      );

      logger.info('Recording started', { roomId, sessionId });
      io.to(roomId).emit(SOCKET_EVENTS.START_RECORDING, { sessionId });

      // Update meeting status
      await meetingService.updateStatus(roomId, 'recording');
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

  socket.on(SOCKET_EVENTS.STOP_RECORDING, async ({ roomId }) => {
    try {
      if (!roomId) return;

      await recordingStateRepo.stopRecording(roomId);
      logger.info('Recording stopped', { roomId });
      io.to(roomId).emit(SOCKET_EVENTS.STOP_RECORDING, {});

      // Update meeting status
      await meetingService.updateStatus(roomId, 'active');
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
