export interface DailyParticipant {
  session_id: string; // Daily's per-connection ID
  user_id: string; // Our app user_id from meeting token
  user_name: string;
  local: boolean;
  audio: boolean;
  owner: boolean;
}

export type NetworkQuality = "good" | "warning" | "bad" | "unknown";

/** SDK event names we listen to for triggering server polls */
export type DailySdkEvent =
  | "participant-joined"
  | "participant-left"
  | "recording-started"
  | "recording-stopped";

// ── App-message types (peer-to-peer via Daily sendAppMessage) ──
export type AppMessage =
  | { type: "mute-state"; muted: boolean };

export interface DailyCallState {
  isJoined: boolean;
  isMuted: boolean;
  networkQuality: NetworkQuality;
  micLevel: number;
  participants: DailyParticipant[];
  error: string | null;
  /** Local user's Daily connection_id (session_id in Daily terms) */
  localConnectionId: string | null;
  /** Local user's user_id from the meeting token */
  localUserId: string | null;
}
