/**
 * recordingRepo.ts — Data access layer for the Recordings table.
 *
 * DynamoDB Table: AudioStudio_Recordings
 * Primary Key:    meetingId (partition) + recordingId (sort)
 * GSI:            UploadIndex (uploadId) — find recordings by S3 multipart upload ID
 * Model Type:     Recording (defined in shared/types/meeting.ts)
 *
 * Each recording entry represents one participant's audio file for a session.
 * A complete session has exactly 2 recordings (host + guest). The recordingId
 * format encodes the session and participant: `{sessionId}#{participantName}`.
 *
 * Key operations:
 *   - createRecording: track a new upload (status: 'uploading')
 *   - getRecordingsBySession: fetch recordings for a specific session (uses sort key prefix)
 *   - findByUploadId: look up recording by S3 multipart upload ID (UploadIndex GSI)
 *   - updateRecordingStatus: mark as 'completed' after upload finishes
 *   - areAllParticipantRecordingsComplete: check if both host+guest uploads are done
 *     (triggers the processing pipeline when true)
 */
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../infra/dynamodb';
import type { Recording } from '../shared';
import { RECORDING_STATUS } from '../shared';
import { logger } from '../utils/logger';

/** Create a new recording entry (initially with status 'uploading') */
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

/** Get recordings for a specific session using the recordingId sort key prefix (sessionId#) */
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

/** Find a recording by its S3 multipart upload ID (via UploadIndex GSI) */
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
  return recordings.filter((r) => r.status === RECORDING_STATUS.COMPLETED);
}

/**
 * Check if both participants' recordings are complete for a session.
 * Returns true when 2+ completed recordings exist — this triggers
 * the processing pipeline via pipelineService.triggerProcessingIfReady().
 */
export async function areAllParticipantRecordingsComplete(
  meetingId: string,
  sessionId: string,
): Promise<{ complete: boolean; recordings: Recording[] }> {
  const recordings = await getRecordingsBySession(meetingId, sessionId);
  const completed = recordings.filter((r) => r.status === RECORDING_STATUS.COMPLETED);
  // We expect 2 recordings (host + guest) for a complete session
  return { complete: completed.length >= 2, recordings: completed };
}
