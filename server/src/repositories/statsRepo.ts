import { UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from '../infra/dynamodb';

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
