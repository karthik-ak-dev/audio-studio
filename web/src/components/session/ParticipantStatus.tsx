import type { DailyParticipant } from "@/types/daily";
import { Badge } from "@/components/ui/Badge";

interface ParticipantStatusProps {
  participants: DailyParticipant[];
}

export function ParticipantStatus({ participants }: ParticipantStatusProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        Participants ({participants.length}/2)
      </span>
      <div className="flex flex-col gap-1.5">
        {participants.map((p) => (
          <div
            key={p.session_id}
            className="flex items-center justify-between rounded-md bg-white/[0.03] px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${p.audio ? "bg-accent" : "bg-red-500"}`}
              />
              <span className="text-sm text-text">
                {p.user_name || "Unknown"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {p.local && <Badge variant="neutral">You</Badge>}
              {p.owner && <Badge variant="accent">Host</Badge>}
              {!p.audio && <Badge variant="error">Muted</Badge>}
            </div>
          </div>
        ))}

        {participants.length < 2 && (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2">
            <span className="h-2 w-2 animate-blink rounded-full bg-text-muted/30" />
            <span className="text-sm text-text-muted">Waiting for guest...</span>
          </div>
        )}
      </div>
    </div>
  );
}
