import { AUDIO_THRESHOLDS } from '../shared';
import type { MicCheckMetrics, MicStatus } from '../shared';

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
