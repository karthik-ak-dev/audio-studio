/**
 * VolumeIndicator.tsx — Production-grade audio level meter.
 *
 * Renders a horizontal level meter with:
 * - Segmented bar with color zones (too quiet / good / hot / clipping)
 * - Smooth peak hold indicator
 * - Gradient fill that maps to professional audio ranges
 *
 * Expects EMA-smoothed values from useAudioMetrics for fluid motion.
 * The smoothing happens in the hook; this component just renders.
 */

interface VolumeIndicatorProps {
  /** EMA-smoothed RMS level in dBFS (typically -60 to 0) */
  rmsDb: number;
  /** EMA-smoothed peak level in dBFS (typically -60 to 0) */
  peakDb: number;
  /** Whether any samples in the current frame exceeded the clip threshold */
  isClipping: boolean;
  /** When true, hides the dBFS scale labels beneath the meter */
  hideLabels?: boolean;
}

/** Map dBFS to 0-100 percentage. Range: -60 dBFS → 0%, 0 dBFS → 100% */
function dbToPercent(db: number): number {
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

export default function VolumeIndicator({ rmsDb, peakDb, isClipping, hideLabels = false }: VolumeIndicatorProps) {
  const level = dbToPercent(rmsDb);
  const peakLevel = dbToPercent(peakDb);

  // Zone thresholds as percentages: -40dBFS → 33%, -6dBFS → 90%
  const quietZone = 33;
  const hotZone = 90;

  const getBarGradient = () => {
    if (isClipping) return 'bg-red-500';
    if (level > hotZone) return 'bg-gradient-to-r from-green-500 via-yellow-400 to-red-400';
    if (level > quietZone) return 'bg-gradient-to-r from-green-600 to-green-400';
    return 'bg-gray-500';
  };

  return (
    <div className="space-y-1.5">
      {/* Meter track */}
      <div className="relative w-full h-4 overflow-hidden border rounded-md bg-gray-800/80 border-gray-700/50">
        {/* Zone markers: quiet | good | hot */}
        <div
          className="absolute top-0 z-10 w-px h-full bg-gray-600/40"
          style={{ left: `${quietZone}%` }}
        />
        <div
          className="absolute top-0 z-10 w-px h-full bg-gray-600/40"
          style={{ left: `${hotZone}%` }}
        />

        {/* RMS fill bar — no CSS transition, smoothing is in the hook */}
        <div
          className={`h-full rounded-sm ${getBarGradient()}`}
          style={{ width: `${level}%` }}
        />

        {/* Peak hold line */}
        <div
          className="absolute top-0 h-full w-0.5 bg-white/70 rounded-full z-10"
          style={{ left: `${peakLevel}%` }}
        />
      </div>

      {/* Scale labels — hidden in GreenRoom for clean UX, shown in Studio */}
      {!hideLabels && (
        <div className="flex justify-between text-[10px] text-gray-600 px-0.5">
          <span>-60</span>
          <span style={{ position: 'absolute', left: `${quietZone}%`, transform: 'translateX(-50%)' }} className="relative">-40</span>
          <span style={{ position: 'absolute', left: `${hotZone}%`, transform: 'translateX(-50%)' }} className="relative">-6</span>
          <span>0 dBFS</span>
        </div>
      )}
    </div>
  );
}
