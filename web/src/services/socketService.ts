/**
 * socketService.ts — Socket.IO singleton connection manager.
 *
 * Manages a single Socket.IO client instance shared across the application.
 * The singleton pattern ensures only one connection exists at a time,
 * preventing duplicate event listeners and race conditions.
 *
 * ## Connection Configuration
 *
 * - **Server URL**: From VITE_SERVER_URL env var, or same-origin (empty string)
 * - **Transports**: WebSocket preferred, polling fallback
 * - **Credentials**: Enabled for cross-origin cookie/session support
 * - **Auto-connect**: Disabled — caller must explicitly call connectSocket()
 * - **Reconnection**: Up to 5 attempts, 1-5 second exponential backoff
 *
 * ## Usage Pattern
 *
 * Each page manages its own connection lifecycle:
 *
 * ```
 * GreenRoom:
 *   mount → connectSocket() → emit mic-check events
 *   unmount → disconnectSocket() (clean slate for Studio)
 *
 * Studio:
 *   mount → connectSocket() → join-room, register all event listeners
 *   unmount → disconnectSocket()
 *
 * Results:
 *   mount → connectSocket() → join-room (for processing events)
 *   unmount → disconnectSocket()
 * ```
 *
 * ## Why Singleton?
 *
 * Socket.IO's server matches sockets by ID. If multiple connections existed,
 * the server would treat them as different users, breaking the room model
 * (which allows max 2 participants). A singleton ensures consistent identity.
 *
 * ## Server Expectations
 *
 * The server is configured with:
 *   - Ping interval: 10s, timeout: 15s
 *   - Max message size: 1MB
 *   - Redis adapter for multi-pod scaling (optional)
 */

import { io, Socket } from 'socket.io-client';

/** Server URL — empty string means same-origin (Vite proxy in dev) */
const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

/** Singleton socket instance — null until first getSocket() call */
let socket: Socket | null = null;

/**
 * Get or create the singleton Socket.IO instance.
 * Does NOT auto-connect — call connectSocket() to establish the connection.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: false,                // Caller controls when to connect
      transports: ['websocket', 'polling'], // WebSocket preferred, polling fallback
      withCredentials: true,             // Send cookies for cross-origin requests
      reconnection: true,               // Auto-reconnect on disconnect
      reconnectionAttempts: 5,           // Give up after 5 failed attempts
      reconnectionDelay: 1000,           // Start with 1s delay
      reconnectionDelayMax: 5000,        // Max 5s between attempts
    });
  }
  return socket;
}

/**
 * Connect the socket if not already connected.
 * Returns the socket instance for immediate use.
 */
export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
}

/**
 * Disconnect the socket if currently connected.
 * Does NOT destroy the singleton — next connectSocket() will reconnect.
 */
export function disconnectSocket(): void {
  if (socket?.connected) {
    socket.disconnect();
  }
}
