/**
 * pipelineService.ts — Triggers the external audio processing pipeline via SQS.
 *
 * After recording stops and both participants upload their audio files,
 * this service checks if all recordings are complete and, if so, publishes
 * a ProcessSessionMessage to the SQS FIFO processing queue.
 *
 * The external pipeline (not part of this server) then:
 *   1. Downloads both audio files from S3
 *   2. Runs quality analysis (SNR, echo, overlap, etc.)
 *   3. Classifies the recording quality as P0-P4
 *   4. Optionally generates ASR transcripts and annotator output
 *   5. Publishes a ProcessingResult to the SQS results queue
 *
 * FIFO queue ensures:
 *   - MessageGroupId (roomId): in-order processing per room
 *   - DeduplicationId (roomId:sessionId): no duplicate processing
 */
import type { ProcessSessionMessage } from '../shared';
import { publishMessage, QUEUES } from '../infra/sqs';
import * as recordingRepo from '../repositories/recordingRepo';
import { logger } from '../utils/logger';

/**
 * Check if both participants' recordings are complete for a session.
 * If yes, publish a processing message to the SQS queue.
 * Returns true if the pipeline was triggered, false if not ready yet.
 */
export async function triggerProcessingIfReady(
  roomId: string,
  sessionId: string,
): Promise<boolean> {
  const { complete, recordings } = await recordingRepo.areAllParticipantRecordingsComplete(
    roomId,
    sessionId,
  );

  if (!complete) {
    logger.info('Not all recordings complete yet — skipping pipeline trigger', {
      roomId,
      sessionId,
      completedCount: recordings.length,
    });
    return false;
  }

  // Identify host and guest recordings by participant convention
  // We expect 2 completed recordings for the session
  const hostRecording = recordings[0];
  const guestRecording = recordings[1];

  if (!hostRecording || !guestRecording) {
    logger.warn('Could not identify host/guest recordings', { roomId, sessionId });
    return false;
  }

  const message: ProcessSessionMessage = {
    action: 'process-session',
    roomId,
    sessionId,
    hostKey: hostRecording.filePath,
    guestKey: guestRecording.filePath,
    timestamp: new Date().toISOString(),
  };

  if (!QUEUES.PROCESSING) {
    logger.warn('SQS_PROCESSING_QUEUE_URL not configured — skipping pipeline trigger');
    return false;
  }

  await publishMessage(
    QUEUES.PROCESSING,
    message as unknown as Record<string, unknown>,
    roomId, // MessageGroupId for FIFO — prevents duplicate processing per room
    `${roomId}:${sessionId}`, // Deduplication ID
  );

  logger.info('Processing pipeline triggered', { roomId, sessionId });
  return true;
}
