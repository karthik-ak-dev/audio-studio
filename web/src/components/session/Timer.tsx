interface TimerProps {
  formatted: string;
  progress: number;
  isRecording: boolean;
  isPaused?: boolean;
}

export function Timer({ formatted, progress, isRecording, isPaused = false }: TimerProps) {
  const progressPercent = Math.min(progress * 100, 100);

  const statusLabel = isRecording ? "Recording" : isPaused ? "Paused" : "Ready";
  const statusColor = isRecording ? "text-red-400" : isPaused ? "text-yellow-400" : "text-text-muted";

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Status indicator */}
      <div className="flex items-center gap-2">
        {isRecording && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-red-500" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
        )}
        {isPaused && (
          <span className="inline-flex h-2 w-2 rounded-sm bg-yellow-400" />
        )}
        <span className={`text-[10px] font-bold uppercase tracking-widest ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      {/* Time display */}
      <span className="font-mono text-5xl font-bold tracking-tight text-text md:text-6xl">
        {formatted}
      </span>

      {/* Progress bar */}
      <div className="h-1 w-full max-w-[280px] overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-linear ${
            isRecording ? "bg-red-500/60" : isPaused ? "bg-yellow-400/40" : "bg-accent/30"
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
