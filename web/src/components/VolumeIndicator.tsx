interface VolumeIndicatorProps {
  rmsDb: number;
  peakDb: number;
  isClipping: boolean;
}

export default function VolumeIndicator({ rmsDb, peakDb, isClipping }: VolumeIndicatorProps) {
  // Convert dBFS to 0-100 range (approx: -60dB=0, 0dB=100)
  const level = Math.max(0, Math.min(100, ((rmsDb + 60) / 60) * 100));
  const peakLevel = Math.max(0, Math.min(100, ((peakDb + 60) / 60) * 100));

  const getColor = () => {
    if (isClipping) return 'bg-red-500';
    if (level > 85) return 'bg-yellow-500';
    if (level > 30) return 'bg-green-500';
    return 'bg-gray-500';
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-3 w-full rounded-full bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-75 ${getColor()}`}
          style={{ width: `${level}%` }}
        />
        <div
          className="absolute top-0 h-full w-0.5 bg-white/50 transition-all duration-75"
          style={{ left: `${peakLevel}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>{rmsDb > -Infinity ? `${rmsDb.toFixed(1)} dBFS` : '-- dBFS'}</span>
        {isClipping && <span className="text-red-400 font-medium">CLIPPING</span>}
      </div>
    </div>
  );
}
