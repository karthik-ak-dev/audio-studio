/**
 * sessionRepo.ts — Data access layer for the Sessions table.
 *
 * DynamoDB Table: AudioStudio_Sessions
 * Primary Key:    meetingId (partition) + sessionId (sort)
 * GSIs:           UserIndex (userId) — find sessions by persistent user ID
 *                 SocketIndex (socketId) — find sessions by Socket.IO socket ID
 * Model Type:     Session (defined in shared/types/meeting.ts)
 *
 * Sessions track individual user connections to meeting rooms. A user can have
 * multiple sessions over time (disconnect/reconnect creates new session IDs).
 * The isActive flag distinguishes current connections from historical ones.
 *
 * Key operations:
 *   - createSession: new connection
 *   - findActiveByUserId: reconnection detection (UserIndex GSI)
 *   - findBySocketId: disconnect cleanup (SocketIndex GSI)
 *   - updateSocketId: reconnection (update existing session with new socket)
 *   - markSessionInactive: user left or disconnected
 *   - getActiveSessionCount: room capacity check (max 2)
 */
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../infra/dynamodb';
import type { Session } from '../shared';
import { logger } from '../utils/logger';

/** Create a new session record in DynamoDB */
export async function createSession(session: Session): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLES.SESSIONS,
      Item: session,
    }),
  );
  logger.info('Session created', { meetingId: session.meetingId, sessionId: session.sessionId });
}

/** Get all active sessions for a meeting (used to build participant list) */
export async function getActiveSessionsByMeeting(meetingId: string): Promise<Session[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLES.SESSIONS,
      KeyConditionExpression: 'meetingId = :mid',
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: { ':mid': meetingId, ':active': true },
    }),
  );
  return (result.Items as Session[]) ?? [];
}

/** Find the most recent session for a user (via UserIndex GSI), regardless of active status */
export async function findByUserId(userId: string): Promise<Session | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLES.SESSIONS,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :uid',
      ScanIndexForward: false, // most recent first
      Limit: 1,
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );
  return (result.Items?.[0] as Session) ?? null;
}

/** Find an active session for a user — used to detect reconnections (same user, new socket) */
export async function findActiveByUserId(userId: string): Promise<Session | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLES.SESSIONS,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :uid',
      FilterExpression: 'isActive = :active',
      ScanIndexForward: false,
      Limit: 1,
      ExpressionAttributeValues: { ':uid': userId, ':active': true },
    }),
  );
  return (result.Items?.[0] as Session) ?? null;
}

/** Find a session by socket ID (via SocketIndex GSI) — used during disconnect cleanup */
export async function findBySocketId(socketId: string): Promise<Session | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLES.SESSIONS,
      IndexName: 'SocketIndex',
      KeyConditionExpression: 'socketId = :sid',
      Limit: 1,
      ExpressionAttributeValues: { ':sid': socketId },
    }),
  );
  return (result.Items?.[0] as Session) ?? null;
}

/** Update a session's socket ID during reconnection (same user, new tab/connection) */
export async function updateSocketId(
  meetingId: string,
  sessionId: string,
  newSocketId: string,
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLES.SESSIONS,
      Key: { meetingId, sessionId },
      UpdateExpression: 'SET socketId = :sid, isActive = :active, leftAt = :null',
      ExpressionAttributeValues: { ':sid': newSocketId, ':active': true, ':null': null },
    }),
  );
}

/** Mark a session as inactive (sets isActive=false, leftAt=now) */
export async function markSessionInactive(
  meetingId: string,
  sessionId: string,
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLES.SESSIONS,
      Key: { meetingId, sessionId },
      UpdateExpression: 'SET isActive = :inactive, leftAt = :leftAt',
      ExpressionAttributeValues: {
        ':inactive': false,
        ':leftAt': new Date().toISOString(),
      },
    }),
  );
}

/** Find session by socket ID and mark it inactive — used on disconnect events */
export async function markSessionInactiveBySocketId(socketId: string): Promise<Session | null> {
  const session = await findBySocketId(socketId);
  if (!session) return null;

  await markSessionInactive(session.meetingId, session.sessionId);
  logger.info('Session marked inactive', { meetingId: session.meetingId, socketId });
  return session;
}

/** Find ALL active sessions for a user (via UserIndex GSI) — used to clean up stale sessions */
export async function findAllActiveByUserId(userId: string): Promise<Session[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLES.SESSIONS,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :uid',
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: { ':uid': userId, ':active': true },
    }),
  );
  return (result.Items as Session[]) ?? [];
}

/**
 * Find recent sessions for a user — both active AND recently deactivated.
 * Used to detect reconnections even when the disconnect handler fired before
 * the new join-room arrives (page refresh race condition).
 * A session deactivated within `withinMs` is still considered a reconnection candidate.
 */
export async function findRecentByUserId(userId: string, withinMs: number = 10_000): Promise<Session[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLES.SESSIONS,
      IndexName: 'UserIndex',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );
  const all = (result.Items as Session[]) ?? [];
  const cutoff = Date.now() - withinMs;
  return all.filter((s) => {
    if (s.isActive) return true;
    // Include recently deactivated sessions (within the reconnection window)
    if (s.leftAt) {
      return new Date(s.leftAt).getTime() > cutoff;
    }
    return false;
  });
}

/** Count active sessions for a meeting — used to enforce the 2-participant room limit */
export async function getActiveSessionCount(meetingId: string): Promise<number> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLES.SESSIONS,
      KeyConditionExpression: 'meetingId = :mid',
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: { ':mid': meetingId, ':active': true },
      Select: 'COUNT',
    }),
  );
  return result.Count ?? 0;
}
