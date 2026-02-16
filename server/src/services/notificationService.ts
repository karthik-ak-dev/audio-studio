/**
 * notificationService.ts — Push notifications to connected clients via Socket.IO.
 *
 * This service bridges the SQS consumer (processingResultConsumer) with the
 * Socket.IO layer. When the external processing pipeline returns results via
 * SQS, this service emits the appropriate socket event to the relevant room.
 *
 * The io instance is injected at startup via setIOInstance() — called from
 * server.ts after the Socket.IO server is created.
 *
 * Events emitted:
 *   - PROCESSING_STATUS: pipeline progress updates (step, %, time estimate)
 *   - PROCESSING_COMPLETE: final results with profile and metrics
 *   - RECORDING_REJECTED: quality too low — includes reason and suggestions
 */
import type { Server as SocketIOServer } from 'socket.io';
import { SOCKET_EVENTS } from '../shared';
import type { ProcessingResult } from '../shared';
import { logger } from '../utils/logger';

/** Socket.IO server instance — set once during bootstrap, used for all notifications */
let ioInstance: SocketIOServer | null = null;

export function setIOInstance(io: SocketIOServer): void {
  ioInstance = io;
}

export function notifyProcessingStatus(
  roomId: string,
  step: string,
  progress: number,
  estimatedTimeLeft: number,
): void {
  if (!ioInstance) return;
  ioInstance.to(roomId).emit(SOCKET_EVENTS.PROCESSING_STATUS, {
    step,
    progress,
    estimatedTimeLeft,
  });
}

export function notifyProcessingComplete(roomId: string, result: ProcessingResult): void {
  if (!ioInstance) return;

  if (result.status === 'rejected') {
    ioInstance.to(roomId).emit(SOCKET_EVENTS.RECORDING_REJECTED, {
      reason: result.rejectionReason || 'Quality too low',
      suggestions: result.suggestions || [],
    });
    logger.info('Recording rejected notification sent', { roomId, profile: result.profile });
    return;
  }

  ioInstance.to(roomId).emit(SOCKET_EVENTS.PROCESSING_COMPLETE, {
    profile: result.profile,
    metrics: result.metrics,
    variants: result.variants || {},
    warnings: result.suggestions || [],
  });

  logger.info('Processing complete notification sent', { roomId, profile: result.profile });
}
