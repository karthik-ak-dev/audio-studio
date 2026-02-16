import type { Server as SocketIOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../shared';
import * as greenRoomService from '../services/greenRoomService';
import { logger } from '../utils/logger';

export function handleGreenRoom(io: SocketIOServer, socket: Socket): void {
  socket.on(SOCKET_EVENTS.MIC_CHECK, (data) => {
    try {
      if (!data || typeof data.rms !== 'number') return;

      const status = greenRoomService.evaluate({
        rms: data.rms,
        peak: data.peak ?? 0,
        noiseFloor: data.noiseFloor ?? -60,
        isClipping: data.isClipping ?? false,
      });

      // Send result back to the sender
      socket.emit(SOCKET_EVENTS.MIC_STATUS, status);

      // Also broadcast partner's mic status to the room
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
