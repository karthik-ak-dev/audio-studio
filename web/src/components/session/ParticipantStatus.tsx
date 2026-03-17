import type { DailyParticipant } from "@/types/daily";
import { Badge } from "@/components/ui/Badge";

interface ParticipantStatusProps {
  /** Server roster: user_id → display name (write-once, never removed) */
  participantsRoster: Record<string, string>;
  /** Server active set: user_ids currently connected */
  activeParticipants: string[];
  /** SDK participants for real-time audio status */
  sdkParticipants: DailyParticipant[];
  /** Local user's user_id */
  localUserId: string | null;
  /** Local user's mute state (single source of truth from useDaily) */
  isMuted: boolean;
}

export function ParticipantStatus({
  participantsRoster,
  activeParticipants,
  sdkParticipants,
  localUserId,
  isMuted,
}: ParticipantStatusProps) {
  const activeSet = new Set(activeParticipants);
  const rosterEntries = Object.entries(participantsRoster);

  // Build a lookup from userId → audio state
  // Local user: use isMuted prop (single source of truth, since track.enabled
  // doesn't update SDK's participant.audio)
  // Remote users: use SDK's p.audio, patched by app-message overrides in useDaily
  const sdkAudioMap = new Map<string, boolean>();
  for (const p of sdkParticipants) {
    if (p.local) {
      sdkAudioMap.set(p.user_id, !isMuted);
    } else {
      sdkAudioMap.set(p.user_id, p.audio);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Participants
        </span>
        <span className="text-[10px] font-mono text-text-muted">
          {activeParticipants.length}/2
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {rosterEntries.map(([userId, name]) => {
          const isActive = activeSet.has(userId);
          const isLocal = userId === localUserId;
          const hasAudio = sdkAudioMap.get(userId) ?? false;

          return (
            <div
              key={userId}
              className={`flex items-center justify-between rounded-md px-4 py-3 ring-1 ${
                isActive
                  ? "bg-white/[0.03] ring-white/[0.06]"
                  : "bg-white/[0.01] ring-white/[0.03] opacity-60"
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Avatar */}
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold uppercase ${
                  isActive
                    ? hasAudio
                      ? "bg-accent/10 text-accent"
                      : "bg-red-500/10 text-red-400"
                    : "bg-white/[0.05] text-text-muted"
                }`}>
                  {(name || "?").charAt(0)}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-text">
                    {name || "Unknown"}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {isActive
                      ? hasAudio ? "Audio active" : "Muted"
                      : "Disconnected"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {isLocal && <Badge variant="neutral">You</Badge>}
                {!isActive && <Badge variant="warning">Offline</Badge>}
                {isActive && !hasAudio && <Badge variant="error">Muted</Badge>}
              </div>
            </div>
          );
        })}

        {/* Waiting placeholder when fewer than 2 in roster */}
        {rosterEntries.length < 2 && (
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
