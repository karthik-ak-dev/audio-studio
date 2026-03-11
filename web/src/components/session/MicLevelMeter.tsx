interface MicLevelMeterProps {
  level: number; // 0-1
  isMuted: boolean;
}

export function MicLevelMeter({ level, isMuted }: MicLevelMeterProps) {
  const bars = 12;
  const activeBars = isMuted ? 0 : Math.round(level * bars);

  return (
    <div
      className="flex items-end gap-[3px] rounded-md bg-white/[0.03] px-2.5 py-1.5 ring-1 ring-white/[0.06]"
      aria-label={`Microphone level: ${Math.round(level * 100)}%`}
    >
      {isMuted && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1 h-3 w-3 text-red-400">
          <line x1="2" x2="22" y1="2" y2="22" />
          <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
          <path d="M5 10v2a7 7 0 0 0 12 5" />
          <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
        </svg>
      )}
      {Array.from({ length: bars }, (_, i) => {
        const isActive = i < activeBars;
        const height = 6 + i * 1.5;
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
