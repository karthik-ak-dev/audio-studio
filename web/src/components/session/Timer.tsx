import { ROOM_EXPIRY_HOURS } from "@/config/constants";

interface TimerProps {
  formatted: string;
  isRecording: boolean;
  isPaused?: boolean;
  /** Session created_at ISO timestamp — used to compute room expiry */
  createdAt?: string | null;
}

function formatTimeRemaining(createdAt: string, expiryHours: number): string {
  const expiresAt = new Date(createdAt).getTime() + expiryHours * 60 * 60 * 1000;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return "expired";
  const mins = Math.floor(remaining / 60000);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${hrs}h ${m}m` : `${hrs}h`;
  }
  return `${mins}m`;
}

export function Timer({ formatted, isRecording, isPaused = false, createdAt }: TimerProps) {
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

      {/* Room expiry hint */}
      {createdAt && (
        <div className="mt-1 rounded-md bg-white/[0.04] px-3 py-1.5 ring-1 ring-white/[0.06]">
          <span className="text-xs font-medium text-text-muted">
            Room expires approx in{" "}
            <span className="text-accent">{formatTimeRemaining(createdAt, ROOM_EXPIRY_HOURS)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
