import type { ProcessSessionMessage } from '../shared';
import { publishMessage, QUEUES } from '../infra/sqs';
import * as recordingRepo from '../repositories/recordingRepo';
import { logger } from '../utils/logger';

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
