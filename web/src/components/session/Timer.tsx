interface TimerProps {
  formatted: string;
  progress: number;
  isRecording: boolean;
}

export function Timer({ formatted, progress, isRecording }: TimerProps) {
  const progressPercent = Math.min(progress * 100, 100);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        {isRecording && (
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-red-500" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
        )}
        <span className="font-mono text-4xl font-bold tracking-tight text-text md:text-5xl">
          {formatted}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full max-w-[240px] overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-accent transition-all duration-1000 ease-linear"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <span className="text-[10px] uppercase tracking-wider text-text-muted">
        {isRecording ? "Recording" : "Idle"}
      </span>
    </div>
  );
}
