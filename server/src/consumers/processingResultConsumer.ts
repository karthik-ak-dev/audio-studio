import { receiveMessages, deleteMessage, QUEUES } from '../infra/sqs';
import { notifyProcessingComplete } from '../services/notificationService';
import type { ProcessingResult } from '../shared';
import { logger } from '../utils/logger';

let isRunning = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

export function startConsumer(): void {
  if (!QUEUES.PROCESSING_RESULTS) {
    logger.info('SQS_RESULTS_QUEUE_URL not configured — processing result consumer disabled');
    return;
  }

  isRunning = true;
  logger.info('Processing result consumer started');
  poll();
}

export function stopConsumer(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info('Processing result consumer stopped');
}

async function poll(): Promise<void> {
  if (!isRunning) return;

  try {
    const messages = await receiveMessages(QUEUES.PROCESSING_RESULTS, 5, 20);

    for (const msg of messages) {
      try {
        const result = JSON.parse(msg.Body || '{}') as ProcessingResult;

        if (result.roomId && result.sessionId) {
          notifyProcessingComplete(result.roomId, result);
          logger.info('Processing result delivered', {
            roomId: result.roomId,
            sessionId: result.sessionId,
            profile: result.profile,
          });
        }

        // Delete message after successful processing
        if (msg.ReceiptHandle) {
          await deleteMessage(QUEUES.PROCESSING_RESULTS, msg.ReceiptHandle);
        }
      } catch (err) {
        logger.error('Error processing SQS message', {
          messageId: msg.MessageId,
          error: (err as Error).message,
        });
        // Message will become visible again after visibility timeout
      }
    }
  } catch (err) {
    logger.error('Error polling SQS', { error: (err as Error).message });
  }

  // Schedule next poll
  if (isRunning) {
    pollTimer = setTimeout(poll, 1000);
  }
}
