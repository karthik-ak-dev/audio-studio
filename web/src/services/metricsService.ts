/**
 * metricsService.ts — Client-side audio metrics computation.
 *
 * Analyzes raw audio samples from the Web Audio AnalyserNode and computes
 * metrics used for both local UI display (VolumeIndicator) and server
 * reporting (mic-check in GreenRoom, audio-metrics in Studio).
 *
 * ## Metrics Computed
 *
 * - **RMS (dBFS)** — Root Mean Square of all samples, converted to decibels
 *   relative to full scale. Formula: 20 * log10(sqrt(sum(s²) / N))
 *   Range: -Infinity (silence) to 0 (digital maximum)
 *
 * - **Peak (dBFS)** — Highest absolute sample value, converted to dBFS.
 *   Shows the instantaneous maximum, useful for detecting transients.
 *
 * - **Clip Count** — Number of samples exceeding 0.99 normalized amplitude.
 *   The server uses this to detect clipping:
 *     ≥5 clips/batch → warning
 *     ≥10 clips/batch → critical
 *
 * - **Silence Duration (ms)** — Cumulative time below -50 dBFS since last
 *   speech was detected. Tracked via module-level `silenceStartTime`.
 *   The server warns at ≥30s and flags critical at ≥60s.
 *
 * - **Speech Detected** — Boolean, true when RMS > -50 dBFS (SILENCE_THRESHOLD).
 *   Used by the server to differentiate intentional silence from technical issues.
 *
 * ## Module State
 *
 * `silenceStartTime` is a module-level variable (not React state) because it
 * needs to persist across computeMetrics() calls within a session but reset
 * between sessions via resetMetrics().
 *
 * ## Thread Safety
 *
 * This runs in the main thread, called from requestAnimationFrame in
 * useAudioMetrics. For production scale, consider moving to an AudioWorklet
 * for guaranteed timing, though for a 2-participant app the main thread is fine.
 */

export interface AudioMetrics {
  rms: number;          // dBFS — average signal level
  peak: number;         // dBFS — highest sample in frame
  clipCount: number;    // Number of clipped samples (≥0.99)
  silenceDuration: number; // ms since last speech detected
  speechDetected: boolean; // true if RMS > silence threshold
  rmsStability: number; // stddev of RMS over rolling window (dB)
}

/** Threshold below which audio is considered silence (-50 dBFS) */
const SILENCE_THRESHOLD = -50;

/** Normalized sample value above which we count a clip (0.99 of full scale) */
const CLIP_THRESHOLD = 0.99;

/** Timestamp when silence began — 0 means not currently in silence */
let silenceStartTime = 0;

/** Rolling window of recent RMS values for stability computation (~0.5s at 60fps) */
const RMS_HISTORY_SIZE = 30;
const rmsHistory: number[] = [];

/**
 * Compute audio metrics from a buffer of float audio samples.
 *
 * @param samples — Float32Array of audio samples in [-1.0, 1.0] range,
 *                  typically 2048 samples from AnalyserNode.getFloatTimeDomainData()
 * @returns AudioMetrics with RMS, peak, clip count, silence duration, speech flag
 */
export function computeMetrics(samples: Float32Array): AudioMetrics {
  if (samples.length === 0) {
    return { rms: -Infinity, peak: -Infinity, clipCount: 0, silenceDuration: 0, speechDetected: false, rmsStability: 0 };
  }

  let sum = 0;
  let peak = 0;
  let clipCount = 0;

  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    sum += samples[i] * samples[i]; // Sum of squares for RMS
    if (abs > peak) peak = abs;
    if (abs >= CLIP_THRESHOLD) clipCount++;
  }

  // RMS: sqrt(mean of squares), then convert to dBFS
  const rmsLinear = Math.sqrt(sum / samples.length);
  const rmsDb = rmsLinear > 0 ? 20 * Math.log10(rmsLinear) : -Infinity;
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;

  // Speech detection and silence duration tracking
  const now = Date.now();
  const speechDetected = rmsDb > SILENCE_THRESHOLD;

  let silenceDuration = 0;
  if (speechDetected) {
    // Speech detected — reset silence tracking
    silenceStartTime = 0;
  } else {
    // No speech — track silence duration
    if (silenceStartTime === 0) {
      silenceStartTime = now; // Start of new silence period
    }
    silenceDuration = now - silenceStartTime;
  }

  // Track RMS stability over rolling window
  const clampedRms = rmsDb === -Infinity ? -80 : rmsDb;
  rmsHistory.push(clampedRms);
  if (rmsHistory.length > RMS_HISTORY_SIZE) rmsHistory.shift();

  const rmsStability = computeRmsStability();

  return { rms: rmsDb, peak: peakDb, clipCount, silenceDuration, speechDetected, rmsStability };
}

/**
 * Reset module-level tracking state.
 * Called when starting/stopping metrics to ensure clean state between sessions.
 */
/** Compute standard deviation of RMS values in the rolling window */
function computeRmsStability(): number {
  if (rmsHistory.length < 5) return 0; // Not enough data yet
  const mean = rmsHistory.reduce((a, b) => a + b, 0) / rmsHistory.length;
  const variance = rmsHistory.reduce((sum, v) => sum + (v - mean) ** 2, 0) / rmsHistory.length;
  return Math.sqrt(variance);
}

/**
 * Reset module-level tracking state.
 * Called when starting/stopping metrics to ensure clean state between sessions.
 */
export function resetMetrics(): void {
  silenceStartTime = 0;
  rmsHistory.length = 0;
}
