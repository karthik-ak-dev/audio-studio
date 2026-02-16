import type { Server as SocketIOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../shared';
import * as metricsService from '../services/metricsService';
import { logger } from '../utils/logger';

export function handleLiveMetrics(io: SocketIOServer, socket: Socket): void {
  // Audio metrics ingestion (every 5s from each participant during recording)
  socket.on(SOCKET_EVENTS.AUDIO_METRICS, (data) => {
    try {
      if (!socket.roomId || !data) return;

      const speaker = socket.userEmail || socket.userId || socket.id;

      // We need a sessionId — get it from recording state context
      // The client sends the sessionId with metrics, or we default
      const sessionId = data.sessionId || 'unknown';

      const warnings = metricsService.ingestMetrics(socket.roomId, sessionId, speaker, {
        timestamp: data.timestamp ?? Date.now(),
        rms: data.rms ?? 0,
        peak: data.peak ?? 0,
        clipCount: data.clipCount ?? 0,
        silenceDuration: data.silenceDuration ?? 0,
        speechDetected: data.speechDetected ?? false,
      });

      // Emit warnings to the room
      for (const warning of warnings) {
        io.to(socket.roomId).emit(SOCKET_EVENTS.RECORDING_WARNING, warning);
      }

      // Emit quality update to the room
      const qualityUpdate = metricsService.getQualityUpdate(socket.roomId, sessionId);
      io.to(socket.roomId).emit(SOCKET_EVENTS.QUALITY_UPDATE, qualityUpdate);
    } catch (err) {
      logger.error('Error handling audio metrics', {
        socketId: socket.id,
        error: (err as Error).message,
      });
    }
  });

  // Upload progress relay
  socket.on(SOCKET_EVENTS.UPLOAD_PROGRESS, (data) => {
    if (!socket.roomId || !data) return;
    socket.to(socket.roomId).emit(SOCKET_EVENTS.UPLOAD_PROGRESS, data);
  });
}
