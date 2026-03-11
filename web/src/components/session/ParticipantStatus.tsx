import type { DailyParticipant } from "@/types/daily";
import { Badge } from "@/components/ui/Badge";

interface ParticipantStatusProps {
  participants: DailyParticipant[];
}

export function ParticipantStatus({ participants }: ParticipantStatusProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Participants
        </span>
        <span className="text-[10px] font-mono text-text-muted">
          {participants.length}/2
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {participants.map((p) => (
          <div
            key={p.session_id}
            className="flex items-center justify-between rounded-md bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06]"
          >
            <div className="flex items-center gap-3">
              {/* Avatar placeholder */}
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold uppercase ${
                p.audio ? "bg-accent/10 text-accent" : "bg-red-500/10 text-red-400"
              }`}>
                {(p.user_name || "?").charAt(0)}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-text">
                  {p.user_name || "Unknown"}
                </span>
                <span className="text-[10px] text-text-muted">
                  {p.audio ? "Audio active" : "Muted"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {p.local && <Badge variant="neutral">You</Badge>}
              {p.owner && <Badge variant="accent">Host</Badge>}
              {!p.audio && <Badge variant="error">Muted</Badge>}
            </div>
          </div>
        ))}

        {participants.length < 2 && (
          <div className="flex items-center gap-3 rounded-md border border-dashed border-border px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.03]">
              <span className="h-2 w-2 animate-blink rounded-full bg-text-muted/30" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-text-muted">Waiting for guest...</span>
              <span className="text-[10px] text-text-muted/60">Share the invite link above</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
