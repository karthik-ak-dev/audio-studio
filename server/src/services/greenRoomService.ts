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
import { AUDIO_THRESHOLDS } from '../shared';
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
      ? 'too-quiet'
      : metrics.rms > AUDIO_THRESHOLDS.MIC_TOO_LOUD
        ? 'too-loud'
        : 'good';

  // ── Noise floor ─────────────────────────────────────────────
  const noiseFloor: MicStatus['noiseFloor'] =
    metrics.noiseFloor > AUDIO_THRESHOLDS.NOISE_FLOOR_REJECT
      ? 'unacceptable'
      : metrics.noiseFloor > AUDIO_THRESHOLDS.NOISE_FLOOR_NOISY
        ? 'noisy'
        : 'clean';

  // ── SNR computation ─────────────────────────────────────────
  const snrValue = metrics.rms - metrics.noiseFloor;
  const snr: MicStatus['snr'] =
    snrValue < AUDIO_THRESHOLDS.GREEN_ROOM_SNR_BLOCK
      ? 'blocking'
      : snrValue < AUDIO_THRESHOLDS.GREEN_ROOM_SNR_WARN
        ? 'poor'
        : snrValue < AUDIO_THRESHOLDS.GREEN_ROOM_SNR_GOOD
          ? 'fair'
          : 'good';

  // ── Speech verification ─────────────────────────────────────
  const speechVerified = metrics.speechLikely && level !== 'too-quiet';

  // ── Signal stability ────────────────────────────────────────
  const stability: MicStatus['stability'] =
    metrics.rmsStability > AUDIO_THRESHOLDS.RMS_STABILITY_MAX_STDDEV
      ? 'unstable'
      : 'stable';

  // ── Spectral warnings ──────────────────────────────────────
  const spectralWarnings: SpectralWarning[] = [];
  if (metrics.highFreqEnergy < AUDIO_THRESHOLDS.HIGH_FREQ_ENERGY_MIN && metrics.speechLikely) {
    spectralWarnings.push('muffled');
  }
  if (metrics.humDetected) {
    spectralWarnings.push('hum-detected');
  }
  if (metrics.spectralFlatness > AUDIO_THRESHOLDS.SPECTRAL_FLATNESS_MAX && metrics.rms > AUDIO_THRESHOLDS.MIC_TOO_QUIET) {
    spectralWarnings.push('noise-like');
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
  if (level === 'too-quiet') {
    suggestions.push('Move closer to your microphone or increase input gain');
  }
  if (level === 'too-loud') {
    suggestions.push('Move away from your microphone or reduce input gain');
  }
  if (isClipping) {
    suggestions.push('Your audio is clipping — reduce volume to prevent distortion');
  }

  // ── Noise floor suggestions (existing) ─────────────────────
  if (noiseFloor === 'noisy') {
    suggestions.push('Background noise detected — try a quieter room or use a noise-isolating mic');
  }
  if (noiseFloor === 'unacceptable') {
    suggestions.push('Too much background noise — recording quality will be poor. Please move to a quieter space');
  }

  // ── SNR suggestions ────────────────────────────────────────
  if (snr === 'blocking') {
    suggestions.push('Signal-to-noise ratio is too low for recording — reduce background noise or move closer to the microphone');
  } else if (snr === 'poor') {
    suggestions.push('Signal-to-noise ratio is marginal — consider reducing background noise');
  }

  // ── Stability suggestions ──────────────────────────────────
  if (stability === 'unstable') {
    suggestions.push('Audio signal is unstable — check your cable connection or try a different USB port');
  }

  // ── Spectral suggestions ───────────────────────────────────
  if (spectralWarnings.includes('muffled')) {
    suggestions.push('Audio sounds muffled — check that nothing is covering your microphone');
  }
  if (spectralWarnings.includes('hum-detected')) {
    suggestions.push('Electrical hum detected — try a different USB port or move away from power sources');
  }
  if (spectralWarnings.includes('noise-like')) {
    suggestions.push('Signal sounds like noise rather than speech — check your microphone selection');
  }

  if (suggestions.length === 0) {
    suggestions.push('Audio levels look good!');
  }

  return suggestions;
}
