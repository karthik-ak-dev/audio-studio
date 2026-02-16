/**
 * greenRoomService.ts — Pre-recording microphone quality evaluation.
 *
 * The "green room" is the pre-recording setup phase where participants
 * check their microphone levels before starting. The client periodically
 * sends raw mic metrics (RMS, peak, noise floor, clipping status), and
 * this service evaluates them against the thresholds defined in
 * shared/constants/thresholds.ts.
 *
 * Returns a MicStatus with:
 *   - level: 'good' | 'too-quiet' | 'too-loud'
 *   - noiseFloor: 'clean' | 'noisy' | 'unacceptable'
 *   - clipping: boolean
 *   - suggestions: human-readable tips for the user
 *
 * Used by socket/greenRoom.ts → MIC_CHECK event handler.
 */
import { AUDIO_THRESHOLDS } from '../shared';
import type { MicCheckMetrics, MicStatus } from '../shared';

/**
 * Evaluate mic check metrics and return a classification with suggestions.
 * Compares RMS against MIC_TOO_QUIET/MIC_TOO_LOUD thresholds and noise floor
 * against NOISE_FLOOR_NOISY/NOISE_FLOOR_REJECT thresholds.
 */
export function evaluate(metrics: MicCheckMetrics): MicStatus {
  // Evaluate volume level
  const level: MicStatus['level'] =
    metrics.rms < AUDIO_THRESHOLDS.MIC_TOO_QUIET
      ? 'too-quiet'
      : metrics.rms > AUDIO_THRESHOLDS.MIC_TOO_LOUD
        ? 'too-loud'
        : 'good';

  // Evaluate noise floor
  const noiseFloor: MicStatus['noiseFloor'] =
    metrics.noiseFloor > AUDIO_THRESHOLDS.NOISE_FLOOR_REJECT
      ? 'unacceptable'
      : metrics.noiseFloor > AUDIO_THRESHOLDS.NOISE_FLOOR_NOISY
        ? 'noisy'
        : 'clean';

  // Build suggestions
  const suggestions = buildSuggestions(level, noiseFloor, metrics.isClipping);

  return { level, noiseFloor, clipping: metrics.isClipping, suggestions };
}

function buildSuggestions(
  level: MicStatus['level'],
  noiseFloor: MicStatus['noiseFloor'],
  isClipping: boolean,
): string[] {
  const suggestions: string[] = [];

  if (level === 'too-quiet') {
    suggestions.push('Move closer to your microphone or increase input gain');
  }
  if (level === 'too-loud') {
    suggestions.push('Move away from your microphone or reduce input gain');
  }
  if (isClipping) {
    suggestions.push('Your audio is clipping — reduce volume to prevent distortion');
  }
  if (noiseFloor === 'noisy') {
    suggestions.push('Background noise detected — try a quieter room or use a noise-isolating mic');
  }
  if (noiseFloor === 'unacceptable') {
    suggestions.push('Too much background noise — recording quality will be poor. Please move to a quieter space');
  }

  if (suggestions.length === 0) {
    suggestions.push('Audio levels look good!');
  }

  return suggestions;
}
