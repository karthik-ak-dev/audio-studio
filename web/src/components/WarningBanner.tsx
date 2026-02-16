/**
 * WarningBanner.tsx — Recording quality warning display.
 *
 * Shows real-time quality warnings from the server during an active recording.
 * The server's metricsService analyzes audio-metrics batches and emits
 * `recording-warning` events when it detects issues.
 *
 * ## Warning Types (from server's metricsService)
 *
 * - `too-loud`       — RMS > -6 dBFS (speaker too close / gain too high)
 * - `too-quiet`      — RMS < -40 dBFS while speech detected
 * - `clipping`       — ≥5 clips/batch (warning) or ≥10 (critical)
 * - `long-silence`   — ≥30s cumulative silence (warning) or ≥60s (critical)
 * - `noise-increase` — Detected by post-processing pipeline
 * - `overlap`        — Both speakers talking >20% of the time
 *
 * ## Severity Levels
 *
 * - `warning` (yellow)  — Quality may be degraded but recording is usable
 * - `critical` (red)    — Recording quality is seriously compromised
 *
 * ## Display behavior
 *
 * Studio keeps a rolling window of the last 5 warnings. Warnings are shown
 * as stacked banners, each showing the speaker name and the issue message.
 * Hidden entirely when no warnings are active.
 */

import type { RecordingWarningPayload } from '../shared';

interface WarningBannerProps {
  warnings: RecordingWarningPayload[];
}

export default function WarningBanner({ warnings }: WarningBannerProps) {
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {warnings.map((warning, i) => (
        <div
          key={`${warning.type}-${i}`}
          className={`px-4 py-2 rounded-lg text-sm ${
            warning.severity === 'critical'
              ? 'bg-red-900/50 border border-red-500 text-red-200'
              : 'bg-yellow-900/50 border border-yellow-500 text-yellow-200'
          }`}
        >
          <span className="font-medium">{warning.speaker}:</span> {warning.message}
        </div>
      ))}
    </div>
  );
}
