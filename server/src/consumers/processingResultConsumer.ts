/**
 * processingResultConsumer.ts — SQS consumer for external audio processing results.
 *
 * After a recording is uploaded and the processing pipeline runs (e.g.,
 * noise profiling, SNR analysis, quality scoring), the external pipeline
 * publishes results back to the PROCESSING_RESULTS SQS queue.
 *
 * This consumer:
 *   1. Long-polls the results queue (20s wait, up to 5 messages per batch)
 *   2. Parses each message as a ProcessingResult (contains SNR, SRMR, profile P0-P4)
 *   3. Forwards the result to connected clients via notificationService
 *   4. Deletes the message from the queue after successful delivery
 *
 * Lifecycle:
 *   - startConsumer() — called at server boot; begins the poll loop
 *   - stopConsumer()  — called during graceful shutdown; clears the timer
 *
 * If SQS_RESULTS_QUEUE_URL is not configured, the consumer is disabled
 * (useful in local development without an SQS setup).
 */
import { receiveMessages, deleteMessage, QUEUES } from '../infra/sqs';
import { notifyProcessingComplete } from '../services/notificationService';
import type { ProcessingResult } from '../shared';
import { logger } from '../utils/logger';

// ─── Consumer State ──────────────────────────────────────────────
// Simple flag + timer to control the poll loop. Not a full event
// loop — just a recursive setTimeout chain for simplicity.
let isRunning = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

/** Start the SQS polling loop. Idempotent — safe to call multiple times. */
export function startConsumer(): void {
  if (!QUEUES.PROCESSING_RESULTS) {
    logger.info('SQS_RESULTS_QUEUE_URL not configured — processing result consumer disabled');
    return;
  }

  isRunning = true;
  logger.info('Processing result consumer started');
  poll();
}

/** Stop polling. In-flight requests will complete but no new polls start. */
export function stopConsumer(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info('Processing result consumer stopped');
}

/**
 * Core poll loop — fetches messages, processes them, then schedules the next poll.
 * Uses long-polling (20s) to reduce empty responses and SQS costs.
 * Each message is processed individually so a bad message doesn't block others.
 */
async function poll(): Promise<void> {
  if (!isRunning) return;

  try {
    // Long-poll: wait up to 20s for messages, receive up to 5 at a time
    const messages = await receiveMessages(QUEUES.PROCESSING_RESULTS, 5, 20);

    for (const msg of messages) {
      try {
        const result = JSON.parse(msg.Body || '{}') as ProcessingResult;

        // Only deliver results that have the required identifiers
        if (result.roomId && result.sessionId) {
          notifyProcessingComplete(result.roomId, result);
          logger.info('Processing result delivered', {
            roomId: result.roomId,
            sessionId: result.sessionId,
            profile: result.profile,
          });
        }

        // Delete message after successful processing (acknowledge receipt)
        if (msg.ReceiptHandle) {
          await deleteMessage(QUEUES.PROCESSING_RESULTS, msg.ReceiptHandle);
        }
      } catch (err) {
        logger.error('Error processing SQS message', {
          messageId: msg.MessageId,
          error: (err as Error).message,
        });
        // Message NOT deleted → it becomes visible again after the queue's
        // visibility timeout, allowing a retry (or eventual dead-letter)
      }
    }
  } catch (err) {
    logger.error('Error polling SQS', { error: (err as Error).message });
  }

  // Schedule next poll after a 1s cooldown (prevents tight loop on errors)
  if (isRunning) {
    pollTimer = setTimeout(poll, 1000);
  }
}
