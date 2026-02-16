import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../infra/dynamodb';
import type { Recording } from '../shared';
import { logger } from '../utils/logger';

export async function createRecording(recording: Recording): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLES.RECORDINGS,
      Item: recording,
    }),
  );
  logger.info('Recording created', {
    meetingId: recording.meetingId,
    recordingId: recording.recordingId,
  });
}

export async function getRecordingsByMeeting(meetingId: string): Promise<Recording[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLES.RECORDINGS,
      KeyConditionExpression: 'meetingId = :mid',
      ExpressionAttributeValues: { ':mid': meetingId },
    }),
  );
  return (result.Items as Recording[]) ?? [];
}

export async function getRecordingsBySession(
  meetingId: string,
  sessionId: string,
): Promise<Recording[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLES.RECORDINGS,
      KeyConditionExpression: 'meetingId = :mid AND begins_with(recordingId, :prefix)',
      ExpressionAttributeValues: { ':mid': meetingId, ':prefix': `${sessionId}#` },
    }),
  );
  return (result.Items as Recording[]) ?? [];
}

export async function findByUploadId(uploadId: string): Promise<Recording | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLES.RECORDINGS,
      IndexName: 'UploadIndex',
      KeyConditionExpression: 'uploadId = :uid',
      Limit: 1,
      ExpressionAttributeValues: { ':uid': uploadId },
    }),
  );
  return (result.Items?.[0] as Recording) ?? null;
}

export async function updateRecordingStatus(
  meetingId: string,
  recordingId: string,
  status: Recording['status'],
  s3Url?: string,
): Promise<void> {
  const updateParts = ['#s = :status'];
  const attrNames: Record<string, string> = { '#s': 'status' };
  const attrValues: Record<string, unknown> = { ':status': status };

  if (s3Url !== undefined) {
    updateParts.push('s3Url = :url');
    attrValues[':url'] = s3Url;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLES.RECORDINGS,
      Key: { meetingId, recordingId },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
    }),
  );
}

export async function getCompletedRecordingsForSession(
  meetingId: string,
  sessionId: string,
): Promise<Recording[]> {
  const recordings = await getRecordingsBySession(meetingId, sessionId);
  return recordings.filter((r) => r.status === 'completed');
}

export async function areAllParticipantRecordingsComplete(
  meetingId: string,
  sessionId: string,
): Promise<{ complete: boolean; recordings: Recording[] }> {
  const recordings = await getRecordingsBySession(meetingId, sessionId);
  const completed = recordings.filter((r) => r.status === 'completed');
  // We expect 2 recordings (host + guest) for a complete session
  return { complete: completed.length >= 2, recordings: completed };
}
