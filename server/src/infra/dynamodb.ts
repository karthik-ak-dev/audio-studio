import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { logger } from '../utils/logger';

const config: ConstructorParameters<typeof DynamoDBClient>[0] = {
  region: process.env.AWS_REGION || 'ap-south-1',
};

// LocalStack support for development
if (process.env.DYNAMODB_ENDPOINT) {
  config.endpoint = process.env.DYNAMODB_ENDPOINT;
} else if (process.env.ENV === 'development' && !process.env.KUBERNETES_SERVICE_HOST) {
  config.endpoint = 'http://localhost:4566';
}

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  config.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const client = new DynamoDBClient(config);

export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

// Table names — configurable via env for stage/prod separation
export const TABLES = {
  MEETINGS: process.env.DYNAMO_TABLE_MEETINGS || 'AudioStudio_Meetings',
  SESSIONS: process.env.DYNAMO_TABLE_SESSIONS || 'AudioStudio_Sessions',
  RECORDINGS: process.env.DYNAMO_TABLE_RECORDINGS || 'AudioStudio_Recordings',
  RECORDING_STATE: process.env.DYNAMO_TABLE_RECORDING_STATE || 'AudioStudio_RecordingState',
  GLOBAL_STATS: process.env.DYNAMO_TABLE_STATS || 'AudioStudio_GlobalStats',
} as const;

logger.info('DynamoDB client initialized', { region: config.region, endpoint: config.endpoint });
