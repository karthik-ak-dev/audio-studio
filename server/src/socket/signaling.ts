import type { Server as SocketIOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../shared';
import { logger } from '../utils/logger';

export function handleSignaling(io: SocketIOServer, socket: Socket): void {
  // WebRTC offer — relay to target socket
  socket.on(SOCKET_EVENTS.OFFER, (data) => {
    try {
      if (!data?.target || !data?.sdp) return;
      io.to(data.target).emit(SOCKET_EVENTS.OFFER, { sdp: data.sdp, sender: socket.id });
    } catch (err) {
      logger.error('Error handling offer', { socketId: socket.id, error: (err as Error).message });
    }
  });

  // WebRTC answer — relay to target socket
  socket.on(SOCKET_EVENTS.ANSWER, (data) => {
    try {
      if (!data?.target || !data?.sdp) return;
      io.to(data.target).emit(SOCKET_EVENTS.ANSWER, { sdp: data.sdp, sender: socket.id });
    } catch (err) {
      logger.error('Error handling answer', { socketId: socket.id, error: (err as Error).message });
    }
  });

  // ICE candidate — relay to target socket
  socket.on(SOCKET_EVENTS.ICE_CANDIDATE, (data) => {
    try {
      if (!data?.target || !data?.candidate) return;
      io.to(data.target).emit(SOCKET_EVENTS.ICE_CANDIDATE, {
        candidate: data.candidate,
        sender: socket.id,
      });
    } catch (err) {
      logger.error('Error handling ICE candidate', {
        socketId: socket.id,
        error: (err as Error).message,
      });
    }
  });
}
