/**
 * socket/index.ts — Socket.IO event handler registry.
 *
 * Central entry point for all real-time communication. When a client
 * connects via WebSocket, this module attaches all event handlers to
 * the socket, organized into five handler groups:
 *
 *   1. Session    — join-room, reconnection, disconnect, room state
 *   2. Signaling  — WebRTC offer/answer/ICE relay for peer-to-peer audio
 *   3. Recording  — start/stop recording, recording state management
 *   4. Green Room — pre-recording mic check and quality evaluation
 *   5. Live Metrics — real-time audio quality metrics during recording
 *
 * Additionally handles:
 *   - Chat message relay (broadcast to all participants in the room)
 *   - Socket-level error logging
 *
 * The Socket interface is extended with custom properties (roomId, userId,
 * userRole, userEmail) that are set when a user joins a room and used by
 * all handler modules to identify the connected participant.
 */
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../shared';
import { handleSession } from './session';
import { handleSignaling } from './signaling';
import { handleRecording } from './recording';
import { handleGreenRoom } from './greenRoom';
import { handleLiveMetrics } from './liveMetrics';
import { logger } from '../utils/logger';

// ─── Socket Type Extension ───────────────────────────────────────
// Augment the Socket.IO Socket interface with per-connection metadata.
// These are set in session.ts when a user joins a room and read by
// other handlers (e.g., greenRoom reads socket.roomId, socket.userId).
declare module 'socket.io' {
  interface Socket {
    roomId?: string;              // The meeting room this socket is connected to
    userId?: string;              // Persistent user identifier (survives reconnects)
    userRole?: 'host' | 'guest'; // Role in the meeting
    userEmail?: string;           // User's email address, if provided
  }
}

/**
 * Registers all socket event handlers on the Socket.IO server instance.
 * Called once during server bootstrap (see server.ts).
 */
export function setupSocketHandlers(io: SocketIOServer): void {
  io.on('connection', (socket: Socket) => {
    logger.info('User connected', { socketId: socket.id });

    // Session handlers (join-room, disconnect, reconnection)
    handleSession(io, socket);

    // WebRTC signaling relay (offer, answer, ice-candidate)
    handleSignaling(io, socket);

    // Recording controls (start-recording, stop-recording)
    handleRecording(io, socket);

    // Green room mic check (pre-recording audio quality validation)
    handleGreenRoom(io, socket);

    // Live audio metrics ingestion and quality warnings during recording
    handleLiveMetrics(io, socket);

    // ─── Chat Relay ────────────────────────────────────────────
    // Simple broadcast: sender's message is relayed to all participants
    // in the room (including the sender) with a server-generated timestamp.
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, ({ roomId, message, sender, role }) => {
      if (!roomId || !message) return;
      io.to(roomId).emit(SOCKET_EVENTS.CHAT_MESSAGE, {
        message,
        sender,
        role,
        timestamp: new Date().toISOString(),
      });
    });

    // Catch-all for unhandled socket-level errors
    socket.on('error', (err) => {
      logger.error('Socket error', { socketId: socket.id, error: (err as Error).message });
    });
  });

  logger.info('Socket.io handlers registered');
}
