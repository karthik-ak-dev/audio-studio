export type SessionStatus =
  | "created"
  | "waiting_for_guest"
  | "ready"
  | "recording"
  | "paused"
  | "processing"
  | "completed"
  | "cancelled"
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
  daily_room_url: string | null;

  // Server-driven participant tracking
  participant_count: number;
  active_participants: string[];
  participants: Record<string, string>;

  // Recording state
  recording_started_at: string | null;
  recording_stopped_at: string | null;
  pause_events: Array<{ paused_at: string; resumed_at: string | null }>;

  // S3 data
  s3_key: string | null;
  s3_processed_prefix: string | null;

  // Processed audio file URLs (raw S3 URIs)
  host_audio_url: string | null;
  guest_audio_url: string | null;
  combined_audio_url: string | null;

  // Presigned HTTPS URLs for browser playback/download
  host_audio_presigned_url: string | null;
  guest_audio_presigned_url: string | null;
  combined_audio_presigned_url: string | null;

  // Rejoin URLs
  host_rejoin_url: string | null;
  guest_rejoin_url: string | null;

  error_message: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  room_expires_at: string | null;
}

export interface SessionActionResponse {
  session_id: string;
  status: SessionStatus;
}
