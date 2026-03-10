export interface DailyParticipant {
  session_id: string;
  user_name: string;
  local: boolean;
  audio: boolean;
  owner: boolean;
}

export type NetworkQuality = "good" | "warning" | "bad" | "unknown";

export interface DailyCallState {
  isJoined: boolean;
  isMuted: boolean;
  isRecording: boolean;
  participantCount: number;
  networkQuality: NetworkQuality;
  micLevel: number;
  participants: DailyParticipant[];
  error: string | null;
}
