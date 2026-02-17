/**
 * constants/thresholds.ts — Audio quality thresholds and profile definitions.
 *
 * Defines the numerical thresholds used by both the GreenRoom mic check and
 * the Studio recording quality monitor. All values are in dBFS (decibels
 * relative to full scale), where 0 dBFS is the maximum digital level.
 *
 * ## GreenRoom Mic Check Thresholds
 *
 * Used by the server's `evaluateMicCheck()` to classify mic quality:
 *   - MIC_TOO_QUIET (-40 dBFS) — RMS below this → "too-quiet" level
 *   - MIC_TOO_LOUD (-6 dBFS) — RMS above this → "too-loud" level
 *   - NOISE_FLOOR_GOOD (-45 dBFS) — Below this → "clean" environment
 *   - NOISE_FLOOR_NOISY (-35 dBFS) — Between GOOD and NOISY → "noisy" environment
 *   - NOISE_FLOOR_REJECT (-30 dBFS) — Above this → "unacceptable" noise
 *
 * ## Recording Warning Thresholds
 *
 * Used by the server's MetricsAggregator to trigger real-time warnings:
 *   - CLIP_WARNING_COUNT (5) — Number of clips before warning
 *   - SILENCE_WARNING_MS (30s) — Continuous silence duration before warning
 *   - SILENCE_THRESHOLD (-50 dBFS) — Below this is considered silence
 *   - OVERLAP_WARNING_PCT (20%) — Simultaneous speech percentage trigger
 *   - TOO_QUIET_DURATION_MS (10s) — Sustained quiet before warning
 *
 * ## Quality Profile Thresholds (SNR-based)
 *
 * Maps Signal-to-Noise Ratio to quality tiers:
 *   - P0 "Pristine" — SNR ≥ 25 dB, no issues
 *   - P1 "Clean"    — SNR ≥ 20 dB, minor issues acceptable
 *   - P2 "Usable"   — SNR ≥ 15 dB, some noise or overlap
 *   - P3 "Degraded"  — SNR ≥ 10 dB, significant quality issues
 *   - P4 "Reject"   — SNR < 10 dB, unusable for dataset
 *
 * ## Target Levels
 *
 * Ideal recording levels for professional audio:
 *   - TARGET_RMS_MIN (-26 dBFS) — Minimum acceptable average level
 *   - TARGET_RMS_MAX (-20 dBFS) — Maximum average level before headroom risk
 *   - TARGET_LUFS (-23 LUFS) — EBU R128 broadcast loudness standard
 */
export const AUDIO_THRESHOLDS = {
  // ── GreenRoom Mic Check ──────────────────────────────────────────
  /** RMS below this → mic is too quiet (dBFS) */
  MIC_TOO_QUIET: -40,
  /** RMS above this → mic is too loud / clipping risk (dBFS) */
  MIC_TOO_LOUD: -6,
  /** Noise floor below this → clean recording environment (dBFS) */
  NOISE_FLOOR_GOOD: -45,
  /** Noise floor above this but below REJECT → noisy but usable (dBFS) */
  NOISE_FLOOR_NOISY: -35,
  /** Noise floor above this → unacceptable, suggest environment change (dBFS) */
  NOISE_FLOOR_REJECT: -30,

  // ── Recording Warning Triggers ────────────────────────────────────
  /** Number of audio clips before server sends a clipping warning */
  CLIP_WARNING_COUNT: 5,
  /** Continuous silence duration before long-silence warning (ms) */
  SILENCE_WARNING_MS: 30_000,
  /** RMS below this is considered silence (dBFS) */
  SILENCE_THRESHOLD: -50,
  /** Simultaneous speech percentage before overlap warning */
  OVERLAP_WARNING_PCT: 20,
  /** Sustained quiet speech duration before too-quiet warning (ms) */
  TOO_QUIET_DURATION_MS: 10_000,

  // ── Quality Profile SNR Cutoffs ───────────────────────────────────
  /** P0 "Pristine" — minimum SNR (dB) */
  P0_SNR_MIN: 25,
  /** P1 "Clean" — minimum SNR (dB) */
  P1_SNR_MIN: 20,
  /** P2 "Usable" — minimum SNR (dB) */
  P2_SNR_MIN: 15,
  /** P3 "Degraded" — minimum SNR (dB). Below this → P4 "Reject" */
  P3_SNR_MIN: 10,

  // ── Target Recording Levels ───────────────────────────────────────
  /** Minimum acceptable average RMS for the recording (dBFS) */
  TARGET_RMS_MIN: -26,
  /** Maximum average RMS before headroom becomes a concern (dBFS) */
  TARGET_RMS_MAX: -20,
  /** Target loudness per EBU R128 broadcast standard (LUFS) */
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

/**
 * Quality profile tier — assigned based on SNR and other metrics.
 *   P0 = Pristine, P1 = Clean, P2 = Usable, P3 = Degraded, P4 = Reject
 */
export type QualityProfile = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
