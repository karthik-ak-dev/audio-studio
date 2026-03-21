import type { Session } from "./session";

export interface Recording {
  recording_id: string;
  host_user_id: string;
  host_name: string;
  guest_user_id: string;
  guest_name: string;
  recording_name: string;
  created_at: string;
  updated_at: string;
}

export interface CreateRecordingRequest {
  host_user_id: string;
  host_name: string;
  guest_user_id: string;
  guest_name: string;
  recording_name: string;
}

export interface RecordingWithSessions {
  recording: Recording;
  sessions: Session[];
}
