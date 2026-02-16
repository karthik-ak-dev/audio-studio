/**
 * VolumeIndicator.tsx — Real-time audio level meter.
 *
 * Displays the user's microphone input level as a horizontal bar with:
 * - **RMS level** (main bar) — Shows the average signal strength
 * - **Peak indicator** (thin white line) — Shows the highest sample peak
 * - **Clipping alert** — "CLIPPING" text when samples hit 0.99+ normalized
 *
 * ## dBFS to visual conversion
 *
 * Audio levels arrive in dBFS (decibels relative to full scale):
 *   - 0 dBFS = maximum (digital full scale)
 *   - -60 dBFS = near silence
 *   - -Infinity dBFS = absolute silence
 *
 * We map [-60dB, 0dB] → [0%, 100%] width for the visual bar.
 *
 * ## Color coding
 *
 * Matches the server's AUDIO_THRESHOLDS for consistency:
 *   - Green (level 30-85%) — Normal operating range (-40 to -6 dBFS)
 *   - Yellow (level >85%)  — Getting loud, approaching -6 dBFS
 *   - Red (clipping)       — Samples hitting digital ceiling
 *   - Gray (level <30%)    — Too quiet, below -40 dBFS
 *
 * ## Usage
 *
 * Used in both GreenRoom (mic test) and Studio (live monitoring).
 * Updates at ~60fps via requestAnimationFrame in useAudioMetrics.
 */

interface VolumeIndicatorProps {
  /** RMS level in dBFS (typically -60 to 0) */
  rmsDb: number;
  /** Peak level in dBFS (typically -60 to 0) */
  peakDb: number;
  /** Whether any samples in the current frame exceeded the clip threshold */
  isClipping: boolean;
}

export default function VolumeIndicator({ rmsDb, peakDb, isClipping }: VolumeIndicatorProps) {
  // Convert dBFS to 0-100 range: -60dB → 0%, 0dB → 100%
  const level = Math.max(0, Math.min(100, ((rmsDb + 60) / 60) * 100));
  const peakLevel = Math.max(0, Math.min(100, ((peakDb + 60) / 60) * 100));

  /** Determine bar color based on level and clipping state */
  const getColor = () => {
    if (isClipping) return 'bg-red-500';
    if (level > 85) return 'bg-yellow-500';  // Approaching too-loud threshold
    if (level > 30) return 'bg-green-500';   // Good operating range
    return 'bg-gray-500';                     // Too quiet
  };

  return (
    <div className="flex flex-col gap-1">
      {/* Main level bar with peak indicator overlay */}
      <div className="relative w-full h-3 overflow-hidden bg-gray-800 rounded-full">
        {/* RMS level bar — smooth 75ms transition for visual polish */}
        <div
          className={`h-full rounded-full transition-all duration-75 ${getColor()}`}
          style={{ width: `${level}%` }}
        />
        {/* Peak indicator — thin white line showing highest sample */}
        <div
          className="absolute top-0 h-full w-0.5 bg-white/50 transition-all duration-75"
          style={{ left: `${peakLevel}%` }}
        />
      </div>
      {/* dBFS readout and clipping warning */}
      <div className="flex justify-between text-xs text-gray-500">
        <span>{rmsDb > -Infinity ? `${rmsDb.toFixed(1)} dBFS` : '-- dBFS'}</span>
        {isClipping && <span className="font-medium text-red-400">CLIPPING</span>}
      </div>
    </div>
  );
}
