/**
 * metrics.ts — Types for audio quality metrics and live monitoring.
 *
 * These types power two features:
 *
 *   1. Green Room Mic Check — Before recording, users run a quick mic check.
 *      The client sends MicCheckMetrics, the server evaluates it via
 *      greenRoomService, and returns a MicStatus with suggestions.
 *
 *   2. Live Recording Metrics — During active recording, each participant
 *      sends AudioMetricsBatch updates (~every 5 seconds). The server
 *      aggregates these into SpeakerMetricsAggregate (per-speaker) and
 *      RoomMetricsAggregate (per-room), then generates RecordingWarnings
 *      and quality profile estimates in real time.
 *
 * The metrics are stored in-memory (metricsService.ts) and are ephemeral
 * — they are lost when the server pod restarts. The definitive quality
 * profile is computed by the async processing pipeline, not these live
 * estimates.
 */

import type { QualityProfile } from '../constants/thresholds';

// ─── Green Room Types ─────────────────────────────────────────────

/**
 * Raw mic check metrics sent by the client during the green room phase.
 * These are instantaneous measurements of the user's microphone.
 */
export interface MicCheckMetrics {
  rms: number;          // Root Mean Square volume (dBFS, -60 to 0; closer to 0 = louder)
  peak: number;         // Peak amplitude (dBFS)
  noiseFloor: number;   // Background noise level (dBFS; lower = quieter = better)
  isClipping: boolean;  // Whether the signal exceeds 0 dBFS (causes distortion)

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
 * Evaluated mic status returned by greenRoomService.evaluate().
 * Contains human-readable classifications and actionable suggestions.
 */
export interface MicStatus {
  level: 'good' | 'too-quiet' | 'too-loud';       // Volume classification
  noiseFloor: 'clean' | 'noisy' | 'unacceptable'; // Background noise classification
  clipping: boolean;                                // Whether clipping is occurring
  suggestions: string[];                            // Actionable user-facing tips

  // ── Enhanced checks ─────────────────────────────────────────
  snr: 'good' | 'fair' | 'poor' | 'blocking';
  snrValue: number;             // Computed SNR in dB (for display)
  speechVerified: boolean;      // Speech spectrally verified (not just RMS)
  stability: 'stable' | 'unstable';
  spectralWarnings: SpectralWarning[];
}

// ─── Live Recording Metrics Types ─────────────────────────────────

/**
 * A single batch of audio metrics from one participant.
 * Sent periodically (~5s intervals) during an active recording.
 * Each batch summarizes audio characteristics over that time window.
 */
export interface AudioMetricsBatch {
  timestamp: number;       // Unix timestamp (ms) when the batch was captured
  rms: number;             // Average RMS level in this window (dBFS)
  peak: number;            // Peak level in this window (dBFS)
  clipCount: number;       // Number of clipping events in this window
  silenceDuration: number; // Cumulative silence in this window (ms)
  speechDetected: boolean; // Whether speech was present in this window
}

/**
 * Aggregated metrics for a single speaker across the entire recording session.
 * Maintained in-memory by metricsService and updated with each incoming batch.
 * Uses running averages to avoid storing every individual batch.
 */
export interface SpeakerMetricsAggregate {
  totalBatches: number;       // How many batches have been ingested for this speaker
  avgRms: number;             // Running average RMS (dBFS) — computed incrementally
  peakRms: number;            // Highest peak RMS seen across all batches
  totalClips: number;         // Cumulative clip count across all batches
  totalSilenceMs: number;     // Cumulative silence duration (ms) across all batches
  speechRatio: number;        // Running average of speech detection (0.0–1.0)
  lastBatchTimestamp: number; // Timestamp of the most recent batch
}

/**
 * Aggregated metrics for an entire room (both speakers).
 * One instance exists per active recording session, keyed by `{roomId}:{sessionId}`.
 * Updated every time any speaker's metrics are ingested.
 */
export interface RoomMetricsAggregate {
  roomId: string;                                  // Meeting ID
  sessionId: string;                               // Recording session ID
  speakers: Record<string, SpeakerMetricsAggregate>; // Per-speaker aggregates, keyed by email/userId
  overlapPercent: number;                          // Estimated % of time both speakers talk simultaneously
  estimatedProfile: QualityProfile;                // Live quality estimate (P0=best, P4=worst)
  startedAt: number;                               // Unix timestamp (ms) when this session started
}

/**
 * A recording quality warning generated by metricsService when
 * thresholds are exceeded. Emitted to the room via the
 * RECORDING_WARNING socket event for real-time UI feedback.
 */
export interface RecordingWarning {
  type: 'too-loud' | 'too-quiet' | 'clipping' | 'long-silence' | 'noise-increase' | 'overlap';
  speaker: string;                // Who triggered the warning (email, userId, or 'both' for overlap)
  message: string;                // Human-readable warning description
  severity: 'warning' | 'critical'; // Severity for UI treatment (yellow vs red)
}
