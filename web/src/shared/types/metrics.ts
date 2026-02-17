/**
 * types/metrics.ts — Audio metrics and quality analysis types.
 *
 * Defines the data structures for audio quality monitoring at three levels:
 *
 * 1. **MicCheckMetrics** — Single-snapshot metrics from GreenRoom mic test
 * 2. **AudioMetricsBatch** — Periodic metrics during recording (sent every ~1s)
 * 3. **SpeakerMetricsAggregate** — Server-side accumulated stats per speaker
 * 4. **RoomMetricsAggregate** — Server-side room-level quality assessment
 * 5. **RecordingWarning** — Real-time warnings emitted during recording
 *
 * ## Data Flow
 *
 * Client (metricsService):
 *   MediaStream → AnalyserNode → computeMetrics()
 *                                      ↓
 *   GreenRoom: MicCheckMetrics → emit('mic-check')
 *   Studio:    AudioMetricsBatch → emit('audio-metrics')
 *
 * Server (MetricsAggregator):
 *   AudioMetricsBatch → SpeakerMetricsAggregate → RoomMetricsAggregate
 *                                                        ↓
 *                                              RecordingWarning (if thresholds exceeded)
 *                                              QualityUpdatePayload (profile estimation)
 *
 * ## Quality Profile Assignment
 *
 * The server estimates a quality profile (P0–P4) based on:
 *   - Average RMS across speakers
 *   - Total clip count
 *   - Overlap percentage (simultaneous speech)
 *   - SNR estimation (signal vs noise floor)
 */

import type { QualityProfile } from '../constants/thresholds';

/**
 * Single-snapshot mic check metrics — sent from GreenRoom to server.
 * Computed by metricsService.computeMetrics() from a single AnalyserNode frame.
 */
export interface MicCheckMetrics {
  rms: number;                  // Root-mean-square level (dBFS)
  peak: number;                 // Peak sample level (dBFS)
  noiseFloor: number;           // Estimated background noise (dBFS)
  isClipping: boolean;          // True if any sample reached ±1.0

  // ── Spectral analysis (computed client-side) ────────────────
  voiceBandEnergy: number;      // Fraction of energy in 300Hz–3.4kHz (0–1)
  highFreqEnergy: number;       // Fraction of energy above 2kHz (0–1)
  spectralFlatness: number;     // Wiener entropy (0=tonal/speech, 1=flat/noise)
  humDetected: boolean;         // Concentrated energy at 50Hz or 60Hz

  // ── Consistency ─────────────────────────────────────────────
  rmsStability: number;         // Stddev of RMS over rolling window (dB)

  // ── Improved speech detection ───────────────────────────────
  speechLikely: boolean;        // Speech-like spectral profile detected
}

/** Spectral warning types detected during green room mic check */
export type SpectralWarning = 'muffled' | 'hum-detected' | 'noise-like';

/**
 * Server's assessment of mic quality — response to mic-check event.
 * Classifies the mic into level/noiseFloor tiers with human-readable suggestions.
 */
export interface MicStatus {
  level: 'good' | 'too-quiet' | 'too-loud';
  noiseFloor: 'clean' | 'noisy' | 'unacceptable';
  clipping: boolean;
  suggestions: string[];        // e.g., ["Move mic closer", "Reduce gain"]

  // ── Enhanced checks ─────────────────────────────────────────
  snr: 'good' | 'fair' | 'poor' | 'blocking';
  snrValue: number;             // Computed SNR in dB (for display)
  speechVerified: boolean;      // Speech spectrally verified (not just RMS)
  stability: 'stable' | 'unstable';
  spectralWarnings: SpectralWarning[];
}

/**
 * Periodic audio metrics batch — sent from Studio during recording.
 * The useAudioMetrics hook computes and emits these every ~1 second
 * via the 'audio-metrics' Socket.IO event.
 */
export interface AudioMetricsBatch {
  timestamp: number;            // Unix timestamp (ms)
  rms: number;                  // Average RMS for this batch (dBFS)
  peak: number;                 // Peak level in this batch (dBFS)
  clipCount: number;            // Number of clipping events in this batch
  silenceDuration: number;      // Accumulated silence in this batch (ms)
  speechDetected: boolean;      // Whether speech was detected
}

/**
 * Server-side per-speaker accumulated metrics.
 * The MetricsAggregator maintains one of these per speaker per room.
 * Used internally by the server to compute warnings and quality profiles.
 */
export interface SpeakerMetricsAggregate {
  totalBatches: number;         // Number of AudioMetricsBatch records received
  avgRms: number;               // Running average RMS (dBFS)
  peakRms: number;              // Highest RMS seen (dBFS)
  totalClips: number;           // Cumulative clip count
  totalSilenceMs: number;       // Cumulative silence duration (ms)
  speechRatio: number;          // Fraction of batches with speech detected (0–1)
  lastBatchTimestamp: number;   // Unix timestamp of last batch (ms)
}

/**
 * Server-side room-level metrics aggregate.
 * Combines all speakers' metrics with cross-speaker analysis (overlap).
 * The server uses this to estimate the quality profile and emit warnings.
 */
export interface RoomMetricsAggregate {
  roomId: string;
  sessionId: string;            // Recording session ID
  speakers: Record<string, SpeakerMetricsAggregate>; // Keyed by userId
  overlapPercent: number;       // % of time both speakers are talking simultaneously
  estimatedProfile: QualityProfile; // Current quality estimate (P0–P4)
  startedAt: number;            // Unix timestamp of recording start (ms)
}

/**
 * Real-time recording warning — emitted by server when thresholds are exceeded.
 * Displayed as a WarningBanner component in the Studio UI.
 *
 * Warning types and their triggers (from AUDIO_THRESHOLDS):
 *   - 'too-loud': RMS above MIC_TOO_LOUD (-6 dBFS)
 *   - 'too-quiet': RMS below MIC_TOO_QUIET (-40 dBFS) for TOO_QUIET_DURATION_MS
 *   - 'clipping': clipCount exceeds CLIP_WARNING_COUNT (5)
 *   - 'long-silence': Silence exceeds SILENCE_WARNING_MS (30s)
 *   - 'noise-increase': Noise floor degradation detected
 *   - 'overlap': Simultaneous speech exceeds OVERLAP_WARNING_PCT (20%)
 */
export interface RecordingWarning {
  type: 'too-loud' | 'too-quiet' | 'clipping' | 'long-silence' | 'noise-increase' | 'overlap';
  speaker: string;              // userId of the affected speaker
  message: string;              // Human-readable warning message
  severity: 'warning' | 'critical'; // Critical triggers more prominent UI
}
