import type { Server as SocketIOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../shared';
import { handleSession } from './session';
import { handleSignaling } from './signaling';
import { handleRecording } from './recording';
import { handleGreenRoom } from './greenRoom';
import { handleLiveMetrics } from './liveMetrics';
import { logger } from '../utils/logger';

// Extend Socket with our custom properties
declare module 'socket.io' {
  interface Socket {
    roomId?: string;
    userId?: string;
    userRole?: 'host' | 'guest';
    userEmail?: string;
  }
}

export function setupSocketHandlers(io: SocketIOServer): void {
  io.on('connection', (socket: Socket) => {
    logger.info('User connected', { socketId: socket.id });

    // Session handlers (join-room, disconnect)
    handleSession(io, socket);

    // WebRTC signaling (offer, answer, ice-candidate)
    handleSignaling(io, socket);

    // Recording controls (start-recording, stop-recording)
    handleRecording(io, socket);

    // Green room mic check
    handleGreenRoom(io, socket);

    // Live metrics during recording
    handleLiveMetrics(io, socket);

    // Chat relay
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, ({ roomId, message, sender, role }) => {
      if (!roomId || !message) return;
      io.to(roomId).emit(SOCKET_EVENTS.CHAT_MESSAGE, {
        message,
        sender,
        role,
        timestamp: new Date().toISOString(),
      });
    });

    // Error handler for any unhandled socket errors
    socket.on('error', (err) => {
      logger.error('Socket error', { socketId: socket.id, error: (err as Error).message });
    });
  });

  logger.info('Socket.io handlers registered');
}
