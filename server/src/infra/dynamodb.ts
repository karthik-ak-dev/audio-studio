/**
 * dynamodb.ts — DynamoDB client setup and table name configuration.
 *
 * Creates a DynamoDB Document Client that repositories use for all
 * database operations. The Document Client wraps the low-level client
 * with automatic marshalling/unmarshalling of JavaScript objects to
 * DynamoDB's native AttributeValue format.
 *
 * Environment-aware endpoint resolution:
 *   - If DYNAMODB_ENDPOINT is set → use that (explicit override)
 *   - If ENV=development and NOT in Kubernetes → default to LocalStack (localhost:4566)
 *   - Otherwise → use AWS default endpoint for the configured region
 *
 * Table schema (see shared/types/meeting.ts for the TypeScript interfaces):
 *   - AudioStudio_Meetings       → PK: meetingId
 *   - AudioStudio_Sessions       → PK: meetingId, SK: sessionId
 *                                   GSI UserIndex(userId), GSI SocketIndex(socketId)
 *   - AudioStudio_Recordings     → PK: meetingId, SK: recordingId
 *                                   GSI UploadIndex(uploadId)
 *   - AudioStudio_RecordingState → PK: meetingId
 *   - AudioStudio_GlobalStats    → PK: statKey (singleton: "GLOBAL")
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { logger } from '../utils/logger';

// ─── Client Configuration ─────────────────────────────────────────
const config: ConstructorParameters<typeof DynamoDBClient>[0] = {
  region: process.env.AWS_REGION || 'ap-south-1',
};

// LocalStack support: use local endpoint in development (unless running in k8s)
if (process.env.DYNAMODB_ENDPOINT) {
  config.endpoint = process.env.DYNAMODB_ENDPOINT;
} else if (process.env.ENV === 'development' && !process.env.KUBERNETES_SERVICE_HOST) {
  config.endpoint = 'http://localhost:4566';
}

// Explicit credentials (used in local dev; in AWS, IAM roles handle this)
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  config.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const client = new DynamoDBClient(config);

/**
 * Document Client — all repositories import this for DynamoDB operations.
 * `removeUndefinedValues: true` means we can pass objects with optional
 * fields set to undefined without causing marshalling errors.
 */
export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

// ─── Table Names ──────────────────────────────────────────────────
// Configurable via env vars for stage/prod separation. Each table maps
// to a TypeScript interface defined in shared/types/meeting.ts.
export const TABLES = {
  MEETINGS: process.env.DYNAMO_TABLE_MEETINGS || 'AudioStudio_Meetings',
  SESSIONS: process.env.DYNAMO_TABLE_SESSIONS || 'AudioStudio_Sessions',
  RECORDINGS: process.env.DYNAMO_TABLE_RECORDINGS || 'AudioStudio_Recordings',
  RECORDING_STATE: process.env.DYNAMO_TABLE_RECORDING_STATE || 'AudioStudio_RecordingState',
  GLOBAL_STATS: process.env.DYNAMO_TABLE_STATS || 'AudioStudio_GlobalStats',
} as const;

logger.info('DynamoDB client initialized', { region: config.region, endpoint: config.endpoint });
