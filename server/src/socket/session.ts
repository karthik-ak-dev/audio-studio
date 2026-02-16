import type { Server as SocketIOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS, LIMITS } from '../shared';
import * as sessionRepo from '../repositories/sessionRepo';
import * as recordingStateRepo from '../repositories/recordingStateRepo';
import * as statsRepo from '../repositories/statsRepo';
import * as meetingService from '../services/meetingService';
import { logger } from '../utils/logger';

export function handleSession(io: SocketIOServer, socket: Socket): void {
  socket.on(SOCKET_EVENTS.JOIN_ROOM, async ({ roomId, role, userId, userEmail }) => {
    try {
      // Validate input
      if (!roomId || !role) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'roomId and role are required' });
        return;
      }

      // Auto-create meeting if it doesn't exist
      const meeting = await meetingService.getOrCreateMeeting(roomId);

      // Check for previous session (reconnection)
      let isReconnection = false;
      let effectiveRole = role;
      let effectiveEmail = userEmail || '';
      let effectiveUserId = userId || `user_${socket.id}`;

      const previousSession = userId
        ? await sessionRepo.findActiveByUserId(userId)
        : null;

      if (previousSession && previousSession.meetingId === roomId) {
        // Reconnection flow
        const oldSocketId = previousSession.socketId;
        if (oldSocketId && oldSocketId !== socket.id) {
          // Notify the old tab and disconnect it
          io.to(oldSocketId).emit(SOCKET_EVENTS.DUPLICATE_SESSION, {
            message: 'Meeting opened in another tab',
          });

          const oldSocket = io.sockets.sockets.get(oldSocketId);
          if (oldSocket) {
            logger.info('Cleaning up ghost session', { oldSocketId, userId });
            oldSocket.disconnect(true);

            // Wait for the adapter to clear the old socket (prevents double audio)
            await new Promise((resolve) => setTimeout(resolve, LIMITS.GHOST_SOCKET_DELAY_MS));
          }
        }

        // Update socket ID on the existing session
        await sessionRepo.updateSocketId(
          previousSession.meetingId,
          previousSession.sessionId,
          socket.id,
        );

        isReconnection = true;
        effectiveRole = previousSession.userRole;
        effectiveEmail = userEmail || previousSession.userEmail || '';
        effectiveUserId = previousSession.userId;

        logger.info('User reconnected', { userId, roomId, role: effectiveRole });
      } else {
        // New user — check capacity
        const activeCount = await sessionRepo.getActiveSessionCount(roomId);
        if (activeCount >= LIMITS.MAX_PARTICIPANTS) {
          logger.warn('Room full', { roomId, activeCount });
          socket.emit(SOCKET_EVENTS.ROOM_FULL, {
            message: 'Room is full. Maximum 2 participants allowed.',
          });
          socket.disconnect(true);
          return;
        }

        // Create new session in DynamoDB
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

        // Update stats
        await statsRepo.incrementActiveSession();

        logger.info('New user joined', { userId: effectiveUserId, roomId, role: effectiveRole });
      }

      // Join the Socket.io room
      socket.join(roomId);
      socket.roomId = roomId;
      socket.userId = effectiveUserId;
      socket.userRole = effectiveRole;
      socket.userEmail = effectiveEmail;

      // Get recording state
      const recordingState = await recordingStateRepo.getOrCreateDefault(roomId);

      // Notify others
      socket.to(roomId).emit(SOCKET_EVENTS.USER_JOINED, {
        userId: socket.id,
        persistentId: effectiveUserId,
        role: effectiveRole,
        userEmail: effectiveEmail,
        isReconnection,
      });

      // If reconnecting, tell the other participant to reset peer connection
      if (isReconnection) {
        socket.to(roomId).emit(SOCKET_EVENTS.PEER_RECONNECTED, {
          userId: effectiveUserId,
          newSocketId: socket.id,
        });
      }

      // Build participants list from DynamoDB (multi-pod safe)
      const activeSessions = await sessionRepo.getActiveSessionsByMeeting(roomId);
      const participants = activeSessions.map((s) => ({
        socketId: s.socketId,
        userId: s.userId,
        role: s.userRole,
        userEmail: s.userEmail,
      }));

      // Send room state to the joining user
      socket.emit(SOCKET_EVENTS.ROOM_STATE, {
        meeting,
        participants,
        recordingState,
      });

      // If recording is active and user is reconnecting, send resume
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

  // Disconnect handler
  socket.on('disconnect', async () => {
    logger.info('User disconnected', { socketId: socket.id, roomId: socket.roomId });
    try {
      // Mark session inactive in DynamoDB
      const session = await sessionRepo.markSessionInactiveBySocketId(socket.id);

      if (session && socket.roomId) {
        // Notify others
        io.to(socket.roomId).emit(SOCKET_EVENTS.USER_LEFT, {
          userId: socket.id,
          persistentId: session.userId,
          role: session.userRole,
        });

        // Update stats
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
