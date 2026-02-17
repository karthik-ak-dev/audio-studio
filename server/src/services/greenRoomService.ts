/**
 * greenRoomService.ts — Pre-recording microphone quality evaluation.
 *
 * The "green room" is the pre-recording setup phase where participants
 * check their microphone levels before starting. The client periodically
 * sends raw mic metrics (RMS, peak, noise floor, clipping, spectral
 * analysis, and stability data), and this service evaluates them against
 * the thresholds defined in shared/constants/thresholds.ts.
 *
 * Returns a MicStatus with:
 *   - level: 'good' | 'too-quiet' | 'too-loud'
 *   - noiseFloor: 'clean' | 'noisy' | 'unacceptable'
 *   - clipping: boolean
 *   - snr: 'good' | 'fair' | 'poor' | 'blocking'
 *   - speechVerified: boolean
 *   - stability: 'stable' | 'unstable'
 *   - spectralWarnings: SpectralWarning[]
 *   - suggestions: human-readable tips for the user
 *
 * Used by socket/greenRoom.ts → MIC_CHECK event handler.
 */
import {
  AUDIO_THRESHOLDS, MIC_LEVEL, NOISE_FLOOR_LEVEL, SNR_LEVEL,
  SIGNAL_STABILITY, SPECTRAL_WARNING,
} from '../shared';
import type { MicCheckMetrics, MicStatus, SpectralWarning } from '../shared';

/**
 * Evaluate mic check metrics and return a classification with suggestions.
 * Compares RMS, noise floor, SNR, spectral profile, and signal stability
 * against configured thresholds.
 */
export function evaluate(metrics: MicCheckMetrics): MicStatus {
  // ── Volume level ────────────────────────────────────────────
  const level: MicStatus['level'] =
    metrics.rms < AUDIO_THRESHOLDS.MIC_TOO_QUIET
      ? MIC_LEVEL.TOO_QUIET
      : metrics.rms > AUDIO_THRESHOLDS.MIC_TOO_LOUD
        ? MIC_LEVEL.TOO_LOUD
        : MIC_LEVEL.GOOD;

  // ── Noise floor ─────────────────────────────────────────────
  const noiseFloor: MicStatus['noiseFloor'] =
    metrics.noiseFloor > AUDIO_THRESHOLDS.NOISE_FLOOR_REJECT
      ? NOISE_FLOOR_LEVEL.UNACCEPTABLE
      : metrics.noiseFloor > AUDIO_THRESHOLDS.NOISE_FLOOR_NOISY
        ? NOISE_FLOOR_LEVEL.NOISY
        : NOISE_FLOOR_LEVEL.CLEAN;

  // ── SNR computation ─────────────────────────────────────────
  const snrValue = metrics.rms - metrics.noiseFloor;
  const snr: MicStatus['snr'] =
    snrValue < AUDIO_THRESHOLDS.GREEN_ROOM_SNR_BLOCK
      ? SNR_LEVEL.BLOCKING
      : snrValue < AUDIO_THRESHOLDS.GREEN_ROOM_SNR_WARN
        ? SNR_LEVEL.POOR
        : snrValue < AUDIO_THRESHOLDS.GREEN_ROOM_SNR_GOOD
          ? SNR_LEVEL.FAIR
          : SNR_LEVEL.GOOD;

  // ── Speech verification ─────────────────────────────────────
  const speechVerified = metrics.speechLikely && level !== MIC_LEVEL.TOO_QUIET;

  // ── Signal stability ────────────────────────────────────────
  const stability: MicStatus['stability'] =
    metrics.rmsStability > AUDIO_THRESHOLDS.RMS_STABILITY_MAX_STDDEV
      ? SIGNAL_STABILITY.UNSTABLE
      : SIGNAL_STABILITY.STABLE;

  // ── Spectral warnings ──────────────────────────────────────
  const spectralWarnings: SpectralWarning[] = [];
  if (metrics.highFreqEnergy < AUDIO_THRESHOLDS.HIGH_FREQ_ENERGY_MIN && metrics.speechLikely) {
    spectralWarnings.push(SPECTRAL_WARNING.MUFFLED);
  }
  if (metrics.humDetected) {
    spectralWarnings.push(SPECTRAL_WARNING.HUM_DETECTED);
  }
  if (metrics.spectralFlatness > AUDIO_THRESHOLDS.SPECTRAL_FLATNESS_MAX && metrics.rms > AUDIO_THRESHOLDS.MIC_TOO_QUIET) {
    spectralWarnings.push(SPECTRAL_WARNING.NOISE_LIKE);
  }

  // ── Build suggestions ───────────────────────────────────────
  const suggestions = buildSuggestions(level, noiseFloor, metrics.isClipping, snr, stability, spectralWarnings);

  return {
    level, noiseFloor, clipping: metrics.isClipping, suggestions,
    snr, snrValue, speechVerified, stability, spectralWarnings,
  };
}

function buildSuggestions(
  level: MicStatus['level'],
  noiseFloor: MicStatus['noiseFloor'],
  isClipping: boolean,
  snr: MicStatus['snr'],
  stability: MicStatus['stability'],
  spectralWarnings: SpectralWarning[],
): string[] {
  const suggestions: string[] = [];

  // ── Volume suggestions (existing) ──────────────────────────
  if (level === MIC_LEVEL.TOO_QUIET) {
    suggestions.push('Move closer to your microphone or increase input gain');
  }
  if (level === MIC_LEVEL.TOO_LOUD) {
    suggestions.push('Move away from your microphone or reduce input gain');
  }
  if (isClipping) {
    suggestions.push('Your audio is clipping — reduce volume to prevent distortion');
  }

  // ── Noise floor suggestions (existing) ─────────────────────
  if (noiseFloor === NOISE_FLOOR_LEVEL.NOISY) {
    suggestions.push('Background noise detected — try a quieter room or use a noise-isolating mic');
  }
  if (noiseFloor === NOISE_FLOOR_LEVEL.UNACCEPTABLE) {
    suggestions.push('Too much background noise — recording quality will be poor. Please move to a quieter space');
  }

  // ── SNR suggestions ────────────────────────────────────────
  if (snr === SNR_LEVEL.BLOCKING) {
    suggestions.push('Signal-to-noise ratio is too low for recording — reduce background noise or move closer to the microphone');
  } else if (snr === SNR_LEVEL.POOR) {
    suggestions.push('Signal-to-noise ratio is marginal — consider reducing background noise');
  }

  // ── Stability suggestions ──────────────────────────────────
  if (stability === SIGNAL_STABILITY.UNSTABLE) {
    suggestions.push('Audio signal is unstable — check your cable connection or try a different USB port');
  }

  // ── Spectral suggestions ───────────────────────────────────
  if (spectralWarnings.includes(SPECTRAL_WARNING.MUFFLED)) {
    suggestions.push('Audio sounds muffled — check that nothing is covering your microphone');
  }
  if (spectralWarnings.includes(SPECTRAL_WARNING.HUM_DETECTED)) {
    suggestions.push('Electrical hum detected — try a different USB port or move away from power sources');
  }
  if (spectralWarnings.includes(SPECTRAL_WARNING.NOISE_LIKE)) {
    suggestions.push('Signal sounds like noise rather than speech — check your microphone selection');
  }

  if (suggestions.length === 0) {
    suggestions.push('Audio levels look good!');
  }

  return suggestions;
}
