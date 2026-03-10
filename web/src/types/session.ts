export type SessionStatus =
  | "created"
  | "waiting_for_guest"
  | "recording"
  | "paused"
  | "stopping"
  | "processing"
  | "completed"
  | "error";

export interface CreateSessionRequest {
  host_user_id: string;
  host_name: string;
  guest_name: string;
}

export interface CreateSessionResponse {
  session_id: string;
  room_url: string;
  host_token: string;
  guest_token: string;
  guest_join_url: string;
}

export interface Session {
  session_id: string;
  status: SessionStatus;
  host_user_id: string;
  host_name: string;
  guest_name: string;
  participant_count: number;
  recording_segments: number;
  recording_started_at: string | null;
  recording_stopped_at: string | null;
  s3_processed_prefix: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionActionResponse {
  session_id: string;
  status: SessionStatus;
}
