import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../infra/dynamodb';
import type { RecordingState } from '../shared';

export async function getRecordingState(meetingId: string): Promise<RecordingState | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLES.RECORDING_STATE,
      Key: { meetingId },
    }),
  );
  return (result.Item as RecordingState) ?? null;
}

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
