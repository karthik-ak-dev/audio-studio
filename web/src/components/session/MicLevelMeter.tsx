interface MicLevelMeterProps {
  level: number; // 0-1
  isMuted: boolean;
}

export function MicLevelMeter({ level, isMuted }: MicLevelMeterProps) {
  const bars = 12;
  const activeBars = isMuted ? 0 : Math.round(level * bars);

  return (
    <div className="flex items-end gap-[3px]" aria-label={`Microphone level: ${Math.round(level * 100)}%`}>
      {Array.from({ length: bars }, (_, i) => {
        const isActive = i < activeBars;
        const height = 8 + i * 2;
        return (
          <div
            key={i}
            className={`
              w-[3px] rounded-full transition-all duration-75
              ${isActive ? "bg-accent shadow-glow-sm" : "bg-white/10"}
            `}
            style={{ height: `${height}px` }}
          />
        );
      })}
    </div>
  );
}
