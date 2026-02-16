/**
 * socket/liveMetrics.ts — Real-time audio quality monitoring during recording.
 *
 * While a recording is in progress, each participant's client sends periodic
 * audio metric snapshots (every ~5s) containing RMS level, peak, clip count,
 * silence duration, and speech detection status.
 *
 * This handler:
 *   1. Ingests metrics into the in-memory metricsService (running averages)
 *   2. Checks for quality warnings (e.g., prolonged silence, clipping, low levels)
 *   3. Broadcasts any warnings to all room participants via RECORDING_WARNING
 *   4. Sends an aggregated quality update (per-speaker averages) via QUALITY_UPDATE
 *
 * Metrics are ephemeral (in-memory only) — they are lost on server restart.
 * Definitive quality analysis comes from the external processing pipeline
 * after the recording is uploaded (see processingResultConsumer.ts).
 *
 * Also handles UPLOAD_PROGRESS relay — when one participant starts uploading
 * their recording, progress updates are forwarded to the other participant
 * so both users see upload status in the UI.
 */
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../shared';
import * as metricsService from '../services/metricsService';
import { logger } from '../utils/logger';

export function handleLiveMetrics(io: SocketIOServer, socket: Socket): void {
  // ─── Audio Metrics Ingestion ─────────────────────────────────
  // Received every ~5s from each participant during an active recording.
  // Each batch updates the running average and may trigger quality warnings.
  socket.on(SOCKET_EVENTS.AUDIO_METRICS, (data) => {
    try {
      if (!socket.roomId || !data) return;

      // Identify the speaker — prefer email for display, fall back to userId/socketId
      const speaker = socket.userEmail || socket.userId || socket.id;

      // sessionId links metrics to a specific recording session;
      // the client sends it (received from START_RECORDING broadcast)
      const sessionId = data.sessionId || 'unknown';

      // Ingest metrics and get back any triggered warnings
      const warnings = metricsService.ingestMetrics(socket.roomId, sessionId, speaker, {
        timestamp: data.timestamp ?? Date.now(),
        rms: data.rms ?? 0,
        peak: data.peak ?? 0,
        clipCount: data.clipCount ?? 0,
        silenceDuration: data.silenceDuration ?? 0,
        speechDetected: data.speechDetected ?? false,
      });

      // Broadcast any quality warnings (e.g., "Clipping detected", "Silence > 30s")
      for (const warning of warnings) {
        io.to(socket.roomId).emit(SOCKET_EVENTS.RECORDING_WARNING, warning);
      }

      // Send aggregated quality snapshot (per-speaker running averages)
      const qualityUpdate = metricsService.getQualityUpdate(socket.roomId, sessionId);
      io.to(socket.roomId).emit(SOCKET_EVENTS.QUALITY_UPDATE, qualityUpdate);
    } catch (err) {
      logger.error('Error handling audio metrics', {
        socketId: socket.id,
        error: (err as Error).message,
      });
    }
  });

  // ─── Upload Progress Relay ───────────────────────────────────
  // When a participant is uploading their recording, relay progress
  // to the partner so both users see the upload status in the UI.
  socket.on(SOCKET_EVENTS.UPLOAD_PROGRESS, (data) => {
    if (!socket.roomId || !data) return;
    socket.to(socket.roomId).emit(SOCKET_EVENTS.UPLOAD_PROGRESS, data);
  });
}
