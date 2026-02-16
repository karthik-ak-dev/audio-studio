/**
 * recordingStateRepo.ts — Data access layer for the RecordingState table.
 *
 * DynamoDB Table: AudioStudio_RecordingState
 * Primary Key:    meetingId (partition key, no sort key)
 * Model Type:     RecordingState (defined in shared/types/meeting.ts)
 *
 * This table stores a singleton recording state per meeting. It tracks:
 *   - Whether recording is currently active (isRecording)
 *   - Who started it and when (startedBySocketId, startedByUserId, startedAt)
 *   - The recording session UUID (groups host+guest recording files)
 *
 * Used by:
 *   - socket/recording.ts: start/stop recording events
 *   - socket/session.ts: send recording state on join, resume on reconnect
 *   - getOrCreateDefault: race-safe initialization (conditional write)
 */
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../infra/dynamodb';
import type { RecordingState } from '../shared';

/** Get the current recording state for a meeting. Returns null if no state exists yet. */
export async function getRecordingState(meetingId: string): Promise<RecordingState | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLES.RECORDING_STATE,
      Key: { meetingId },
    }),
  );
  return (result.Item as RecordingState) ?? null;
}

/** Start recording: create/overwrite the state with isRecording=true and a new sessionId */
export async function startRecording(
  meetingId: string,
  sessionId: string,
  socketId: string,
  userId: string,
): Promise<RecordingState> {
  const state: RecordingState = {
    meetingId,
    isRecording: true,
    startedAt: new Date().toISOString(),
    startedBySocketId: socketId,
    startedByUserId: userId,
    stoppedAt: null,
    sessionId,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLES.RECORDING_STATE,
      Item: state,
    }),
  );

  return state;
}

/** Stop recording: set isRecording=false and record the stop timestamp */
export async function stopRecording(meetingId: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLES.RECORDING_STATE,
      Key: { meetingId },
      UpdateExpression: 'SET isRecording = :false, stoppedAt = :stoppedAt',
      ExpressionAttributeValues: {
        ':false': false,
        ':stoppedAt': new Date().toISOString(),
      },
    }),
  );
}

/**
 * Get existing recording state or create a default (not recording) state.
 * Uses a conditional put to avoid race conditions when two requests
 * try to create the default simultaneously — the loser re-fetches.
 */
export async function getOrCreateDefault(meetingId: string): Promise<RecordingState> {
  const existing = await getRecordingState(meetingId);
  if (existing) return existing;

  const defaultState: RecordingState = {
    meetingId,
    isRecording: false,
    startedAt: null,
    startedBySocketId: null,
    startedByUserId: null,
    stoppedAt: null,
    sessionId: null,
  };

  // Use conditional put to avoid race condition
  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLES.RECORDING_STATE,
        Item: defaultState,
        ConditionExpression: 'attribute_not_exists(meetingId)',
      }),
    );
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      // Another request created it — fetch and return
      return (await getRecordingState(meetingId))!;
    }
    throw err;
  }

  return defaultState;
}
