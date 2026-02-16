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
} as const;

export type QualityProfile = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
