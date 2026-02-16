import type { Server as SocketIOServer } from 'socket.io';
import { SOCKET_EVENTS } from '../shared';
import type { ProcessingResult } from '../shared';
import { logger } from '../utils/logger';

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
