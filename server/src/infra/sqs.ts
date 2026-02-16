import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { logger } from '../utils/logger';

const sqsConfig: ConstructorParameters<typeof SQSClient>[0] = {
  region: process.env.AWS_REGION || 'ap-south-1',
};

if (process.env.SQS_ENDPOINT) {
  sqsConfig.endpoint = process.env.SQS_ENDPOINT;
} else if (process.env.ENV === 'development' && !process.env.KUBERNETES_SERVICE_HOST) {
  sqsConfig.endpoint = 'http://localhost:4566';
}

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  sqsConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const sqsClient = new SQSClient(sqsConfig);

// Queue URLs — configured via environment
export const QUEUES = {
  PROCESSING: process.env.SQS_PROCESSING_QUEUE_URL || '',
  PROCESSING_RESULTS: process.env.SQS_RESULTS_QUEUE_URL || '',
} as const;

export async function publishMessage(
  queueUrl: string,
  body: Record<string, unknown>,
  messageGroupId?: string,
  deduplicationId?: string,
): Promise<void> {
  const command = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(body),
    ...(messageGroupId && { MessageGroupId: messageGroupId }),
    ...(deduplicationId && { MessageDeduplicationId: deduplicationId }),
  });
  await sqsClient.send(command);
  logger.info('SQS message published', { queueUrl, messageGroupId });
}

export async function receiveMessages(queueUrl: string, maxMessages = 10, waitTimeSeconds = 20) {
  const command = new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: maxMessages,
    WaitTimeSeconds: waitTimeSeconds,
  });
  const result = await sqsClient.send(command);
  return result.Messages ?? [];
}

export async function deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
  const command = new DeleteMessageCommand({
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle,
  });
  await sqsClient.send(command);
}

logger.info('SQS client initialized', { region: sqsConfig.region });
