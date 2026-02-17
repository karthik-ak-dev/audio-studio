/**
 * thresholds.ts — Audio quality thresholds for recording evaluation.
 *
 * These thresholds are used in two places:
 *   1. greenRoomService — Evaluates mic check metrics before recording
 *   2. metricsService — Detects warnings during live recording and
 *      estimates quality profile (P0-P4)
 *
 * All dB values are in dBFS (decibels relative to full scale):
 *   - 0 dBFS = maximum digital signal (clipping point)
 *   - Negative values = below maximum (e.g., -20 dBFS is normal speech)
 *   - More negative = quieter
 *
 * Quality profiles (P0-P4) represent recording quality tiers:
 *   P0 = Studio quality   — SNR >= 25dB, no clips, minimal overlap
 *   P1 = Good quality     — SNR >= 20dB
 *   P2 = Acceptable       — SNR >= 15dB
 *   P3 = Poor but usable  — SNR >= 10dB
 *   P4 = Unusable/rejected — below P3 thresholds
 */
export const AUDIO_THRESHOLDS = {
  MIC_TOO_QUIET: -40,           // dBFS — below this, mic volume is too low
  MIC_TOO_LOUD: -6,
  NOISE_FLOOR_GOOD: -45,
  NOISE_FLOOR_NOISY: -35,
  NOISE_FLOOR_REJECT: -30,

  CLIP_WARNING_COUNT: 5,
  SILENCE_WARNING_MS: 30_000,
  SILENCE_THRESHOLD: -50,
  OVERLAP_WARNING_PCT: 20,
  TOO_QUIET_DURATION_MS: 10_000,

  P0_SNR_MIN: 25,
  P1_SNR_MIN: 20,
  P2_SNR_MIN: 15,
  P3_SNR_MIN: 10,

  TARGET_RMS_MIN: -26,
  TARGET_RMS_MAX: -20,
  TARGET_LUFS: -23,

  // ── Green Room Enhanced Checks ──────────────────────────────────
  /** Minimum SNR to enter recording (dB). Below this → blocked from recording */
  GREEN_ROOM_SNR_BLOCK: 10,
  /** SNR below this triggers a warning but allows recording (dB) */
  GREEN_ROOM_SNR_WARN: 15,
  /** SNR at or above this is considered good for green room (dB) */
  GREEN_ROOM_SNR_GOOD: 20,
  /** Min ratio of energy in 300Hz–3.4kHz voice band to total energy (0–1) */
  VOICE_BAND_ENERGY_MIN: 0.4,
  /** Spectral flatness above this suggests noise, not speech (0=tonal, 1=flat) */
  SPECTRAL_FLATNESS_MAX: 0.7,
  /** Energy ratio at 50/60Hz vs neighbors — above this = electrical hum */
  HUM_DETECTION_RATIO: 10,
  /** Max acceptable stddev of RMS over rolling window (dB). Above = unstable */
  RMS_STABILITY_MAX_STDDEV: 6,
  /** Min ratio of energy above 2kHz. Below this = muffled audio */
  HIGH_FREQ_ENERGY_MIN: 0.05,
} as const;

export type QualityProfile = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
