/**
 * socket/greenRoom.ts — Green room mic check handler.
 *
 * Before a recording session starts, participants can test their microphone
 * in the "green room" (pre-recording lobby). The client captures a short
 * audio sample and sends metrics (RMS level, peak, noise floor, clipping)
 * to the server via the MIC_CHECK event.
 *
 * Flow:
 *   1. Client sends MIC_CHECK with raw audio metrics (rms, peak, noiseFloor, isClipping)
 *   2. Server evaluates the metrics via greenRoomService.evaluate()
 *      → returns a MicStatus with level (good/fair/poor/silent), suggestions array
 *   3. Result is sent back to the sender (so they see their own mic quality)
 *   4. Result is also broadcast to the room (so the partner sees the other's mic status)
 *
 * The `fromUserId` field is added to the broadcast so the receiving client
 * can tell whose mic status it is (the sender vs. their partner).
 */
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../shared';
import * as greenRoomService from '../services/greenRoomService';
import { logger } from '../utils/logger';

export function handleGreenRoom(io: SocketIOServer, socket: Socket): void {
  socket.on(SOCKET_EVENTS.MIC_CHECK, (data) => {
    try {
      // Guard: RMS is the minimum required metric for evaluation
      if (!data || typeof data.rms !== 'number') return;

      // Evaluate mic quality against configured thresholds (see AUDIO_THRESHOLDS)
      const status = greenRoomService.evaluate({
        rms: data.rms,
        peak: data.peak ?? 0,
        noiseFloor: data.noiseFloor ?? -60,
        isClipping: data.isClipping ?? false,
      });

      // Send result back to the sender (they see their own mic quality indicator)
      socket.emit(SOCKET_EVENTS.MIC_STATUS, status);

      // Broadcast to room so the partner can see this user's mic status
      if (socket.roomId) {
        socket.to(socket.roomId).emit(SOCKET_EVENTS.MIC_STATUS, {
          ...status,
          fromUserId: socket.userId,
        });
      }
    } catch (err) {
      logger.error('Error handling mic check', {
        socketId: socket.id,
        error: (err as Error).message,
      });
    }
  });
}
