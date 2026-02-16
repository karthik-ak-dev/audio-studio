/**
 * socket/session.ts — User session management (join, reconnect, disconnect).
 *
 * This is the most complex socket handler — it manages the full lifecycle
 * of a user's connection to a meeting room, including:
 *
 * ─── JOIN_ROOM Flow ──────────────────────────────────────────────
 *   1. Auto-creates the meeting if it doesn't exist (lazy creation)
 *   2. Checks for an existing active session (reconnection detection):
 *      - If reconnecting: disconnects the old socket (ghost cleanup),
 *        updates the session's socketId, preserves role/email from the
 *        original session, and notifies the partner to reset WebRTC
 *      - If new user: checks room capacity (max 2 participants),
 *        creates a new Session in DynamoDB, increments global stats
 *   3. Joins the Socket.IO room and sets socket metadata (roomId, userId, etc.)
 *   4. Fetches current recording state from DynamoDB
 *   5. Notifies other participants about the new/reconnected user
 *   6. Sends full room state (meeting info, participant list, recording state)
 *      back to the joining user
 *   7. If recording is active and this is a reconnection, sends RESUME_RECORDING
 *      with elapsed time so the client can resume its recording timer
 *
 * ─── Disconnect Flow ────────────────────────────────────────────
 *   1. Marks the session as inactive in DynamoDB (sets leftAt, isActive=false)
 *   2. Notifies remaining participants via USER_LEFT
 *   3. Decrements global active session count
 *
 * ─── Ghost Session Cleanup ──────────────────────────────────────
 *   When a user opens the meeting in a new tab (or their browser reconnects
 *   with a new socket), the old socket becomes a "ghost." This handler:
 *     - Sends DUPLICATE_SESSION to the old socket (shows a warning in the old tab)
 *     - Force-disconnects the old socket
 *     - Waits GHOST_SOCKET_DELAY_MS for the Socket.IO adapter to clean up
 *       (prevents both sockets being in the room simultaneously → double audio)
 *
 * Session IDs are composites of `${userId}#${joinedAt}` to allow multiple
 * sessions per user over time while keeping each unique.
 */
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS, LIMITS } from '../shared';
import * as sessionRepo from '../repositories/sessionRepo';
import * as recordingStateRepo from '../repositories/recordingStateRepo';
import * as statsRepo from '../repositories/statsRepo';
import * as meetingService from '../services/meetingService';
import { logger } from '../utils/logger';

export function handleSession(io: SocketIOServer, socket: Socket): void {
  // ─── Join Room ─────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.JOIN_ROOM, async ({ roomId, role, userId, userEmail }) => {
    try {
      // Validate required fields
      if (!roomId || !role) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'roomId and role are required' });
        return;
      }

      // Lazy meeting creation — the first person to join creates the meeting
      const meeting = await meetingService.getOrCreateMeeting(roomId);

      // ─── Reconnection Detection ─────────────────────────────
      // Look up any existing active session for this userId in this room.
      // If found, this is a reconnection (e.g., page refresh, new tab).
      let isReconnection = false;
      let effectiveRole = role;
      let effectiveEmail = userEmail || '';
      let effectiveUserId = userId || `user_${socket.id}`;

      const previousSession = userId
        ? await sessionRepo.findActiveByUserId(userId)
        : null;

      if (previousSession && previousSession.meetingId === roomId) {
        // ─── Reconnection: Clean Up Ghost Socket ────────────
        const oldSocketId = previousSession.socketId;
        if (oldSocketId && oldSocketId !== socket.id) {
          // Tell the old tab it's been superseded
          io.to(oldSocketId).emit(SOCKET_EVENTS.DUPLICATE_SESSION, {
            message: 'Meeting opened in another tab',
          });

          // Force-disconnect the ghost socket
          const oldSocket = io.sockets.sockets.get(oldSocketId);
          if (oldSocket) {
            logger.info('Cleaning up ghost session', { oldSocketId, userId });
            oldSocket.disconnect(true);

            // Brief delay for the adapter to remove the old socket from the room
            // (prevents both sockets being in the room → double audio streams)
            await new Promise((resolve) => setTimeout(resolve, LIMITS.GHOST_SOCKET_DELAY_MS));
          }
        }

        // Point the existing DynamoDB session to this new socket ID
        await sessionRepo.updateSocketId(
          previousSession.meetingId,
          previousSession.sessionId,
          socket.id,
        );

        // Preserve the original session's role and user info
        isReconnection = true;
        effectiveRole = previousSession.userRole;
        effectiveEmail = userEmail || previousSession.userEmail || '';
        effectiveUserId = previousSession.userId;

        logger.info('User reconnected', { userId, roomId, role: effectiveRole });
      } else {
        // ─── New User: Capacity Check ───────────────────────
        const activeCount = await sessionRepo.getActiveSessionCount(roomId);
        if (activeCount >= LIMITS.MAX_PARTICIPANTS) {
          logger.warn('Room full', { roomId, activeCount });
          socket.emit(SOCKET_EVENTS.ROOM_FULL, {
            message: 'Room is full. Maximum 2 participants allowed.',
          });
          socket.disconnect(true);
          return;
        }

        // ─── New User: Create Session in DynamoDB ───────────
        // sessionId is a composite key: `${userId}#${timestamp}` to allow
        // multiple sessions per user over time while keeping each unique.
        const now = new Date().toISOString();
        await sessionRepo.createSession({
          meetingId: roomId,
          sessionId: `${effectiveUserId}#${now}`,
          userId: effectiveUserId,
          userRole: effectiveRole,
          userEmail: userEmail || null,
          socketId: socket.id,
          joinedAt: now,
          leftAt: null,
          isActive: true,
        });

        // Update global dashboard counters
        await statsRepo.incrementActiveSession();

        logger.info('New user joined', { userId: effectiveUserId, roomId, role: effectiveRole });
      }

      // ─── Attach Metadata to Socket ──────────────────────────
      // These properties are read by other handlers (signaling, recording, etc.)
      socket.join(roomId);
      socket.roomId = roomId;
      socket.userId = effectiveUserId;
      socket.userRole = effectiveRole;
      socket.userEmail = effectiveEmail;

      // Fetch current recording state (is someone recording right now?)
      const recordingState = await recordingStateRepo.getOrCreateDefault(roomId);

      // ─── Notify Other Participants ──────────────────────────
      socket.to(roomId).emit(SOCKET_EVENTS.USER_JOINED, {
        userId: socket.id,
        persistentId: effectiveUserId,
        role: effectiveRole,
        userEmail: effectiveEmail,
        isReconnection,
      });

      // On reconnection, tell the partner to tear down and re-establish
      // the WebRTC peer connection (the old socket ID is no longer valid)
      if (isReconnection) {
        socket.to(roomId).emit(SOCKET_EVENTS.PEER_RECONNECTED, {
          userId: effectiveUserId,
          newSocketId: socket.id,
        });
      }

      // ─── Send Room State to Joining User ────────────────────
      // Build participants list from DynamoDB (multi-pod safe — doesn't
      // rely on Socket.IO's in-memory room, which is pod-local)
      const activeSessions = await sessionRepo.getActiveSessionsByMeeting(roomId);
      const participants = activeSessions.map((s) => ({
        socketId: s.socketId,
        userId: s.userId,
        role: s.userRole,
        userEmail: s.userEmail,
      }));

      socket.emit(SOCKET_EVENTS.ROOM_STATE, {
        meeting,
        participants,
        recordingState,
      });

      // If recording is active and this is a reconnect, send the elapsed time
      // so the client can resume its recording timer and continue capturing audio
      if (recordingState.isRecording && isReconnection && recordingState.startedAt) {
        const startedAtMs = new Date(recordingState.startedAt).getTime();
        socket.emit(SOCKET_EVENTS.RESUME_RECORDING, {
          startedAt: startedAtMs,
          elapsedSeconds: Math.floor((Date.now() - startedAtMs) / 1000),
          sessionId: recordingState.sessionId,
        });
      }
    } catch (err) {
      logger.error('Error joining room', {
        roomId,
        userId,
        socketId: socket.id,
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
      socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to join room' });
    }
  });

  // ─── Disconnect Handler ──────────────────────────────────────
  // When a socket disconnects (tab close, network drop, force-disconnect),
  // clean up the session in DynamoDB and notify remaining participants.
  socket.on('disconnect', async () => {
    logger.info('User disconnected', { socketId: socket.id, roomId: socket.roomId });
    try {
      // Mark session inactive (sets leftAt timestamp, isActive=false)
      // Looks up the session by socketId via the SocketIndex GSI
      const session = await sessionRepo.markSessionInactiveBySocketId(socket.id);

      if (session && socket.roomId) {
        // Let the partner know the other user left
        io.to(socket.roomId).emit(SOCKET_EVENTS.USER_LEFT, {
          userId: socket.id,
          persistentId: session.userId,
          role: session.userRole,
        });

        // Update global dashboard counters
        await statsRepo.decrementActiveSession();
      }
    } catch (err) {
      logger.error('Error handling disconnect', {
        socketId: socket.id,
        roomId: socket.roomId,
        error: (err as Error).message,
      });
    }
  });
}
