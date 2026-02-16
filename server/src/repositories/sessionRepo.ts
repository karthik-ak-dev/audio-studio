import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../infra/dynamodb';
import type { Session } from '../shared';
import { logger } from '../utils/logger';

export async function createSession(session: Session): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLES.SESSIONS,
      Item: session,
    }),
  );
  logger.info('Session created', { meetingId: session.meetingId, sessionId: session.sessionId });
}

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

export async function markSessionInactiveBySocketId(socketId: string): Promise<Session | null> {
  const session = await findBySocketId(socketId);
  if (!session) return null;

  await markSessionInactive(session.meetingId, session.sessionId);
  logger.info('Session marked inactive', { meetingId: session.meetingId, socketId });
  return session;
}

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
