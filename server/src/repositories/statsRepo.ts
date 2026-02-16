/**
 * statsRepo.ts — Data access layer for global platform statistics.
 *
 * DynamoDB Table: AudioStudio_GlobalStats
 * Primary Key:    statKey (partition key, no sort key)
 * Singleton Key:  "GLOBAL" — only one row in the entire table
 *
 * Tracks three live counters:
 *   - activeSessionCount:   total connected users across all meetings
 *   - activeRecordingCount: meetings currently recording
 *   - activePairCount:      rooms with 2 connected participants
 *
 * All counter updates use DynamoDB's atomic ADD operation, making them
 * safe for concurrent updates from multiple server pods without locks.
 *
 * Exposed via GET /api/stats (auth required) for dashboard monitoring.
 */
import { UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../infra/dynamodb';

/** Singleton key — there's only one stats row in the entire table */
const STAT_KEY = 'GLOBAL';

interface GlobalStats {
  statKey: string;
  activeSessionCount: number;
  activeRecordingCount: number;
  activePairCount: number;
}

export async function getStats(): Promise<GlobalStats> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLES.GLOBAL_STATS,
      Key: { statKey: STAT_KEY },
    }),
  );

  return (result.Item as GlobalStats) ?? {
    statKey: STAT_KEY,
    activeSessionCount: 0,
    activeRecordingCount: 0,
    activePairCount: 0,
  };
}

export async function incrementActiveSession(): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLES.GLOBAL_STATS,
      Key: { statKey: STAT_KEY },
      UpdateExpression: 'ADD activeSessionCount :one',
      ExpressionAttributeValues: { ':one': 1 },
    }),
  );
}

export async function decrementActiveSession(): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLES.GLOBAL_STATS,
      Key: { statKey: STAT_KEY },
      UpdateExpression: 'ADD activeSessionCount :negOne',
      ExpressionAttributeValues: { ':negOne': -1 },
    }),
  );
}

export async function incrementActivePair(): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLES.GLOBAL_STATS,
      Key: { statKey: STAT_KEY },
      UpdateExpression: 'ADD activePairCount :one',
      ExpressionAttributeValues: { ':one': 1 },
    }),
  );
}

export async function decrementActivePair(): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLES.GLOBAL_STATS,
      Key: { statKey: STAT_KEY },
      UpdateExpression: 'ADD activePairCount :negOne',
      ExpressionAttributeValues: { ':negOne': -1 },
    }),
  );
}

export async function incrementActiveRecording(): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLES.GLOBAL_STATS,
      Key: { statKey: STAT_KEY },
      UpdateExpression: 'ADD activeRecordingCount :one',
      ExpressionAttributeValues: { ':one': 1 },
    }),
  );
}

export async function decrementActiveRecording(): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLES.GLOBAL_STATS,
      Key: { statKey: STAT_KEY },
      UpdateExpression: 'ADD activeRecordingCount :negOne',
      ExpressionAttributeValues: { ':negOne': -1 },
    }),
  );
}
