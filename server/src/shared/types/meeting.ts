export const MEETING_STATUSES = [
  'scheduled',
  'active',
  'recording',
  'completed',
  'cancelled',
] as const;

export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export interface Meeting {
  meetingId: string;
  title: string;
  hostEmail: string | null;
  guestAName: string | null;
  guestAEmail: string | null;
  guestBName: string | null;
  guestBEmail: string | null;
  scheduledTime: string | null;
  status: MeetingStatus;
  createdAt: string;
}

export interface Session {
  meetingId: string;
  sessionId: string;
  userId: string;
  userRole: 'host' | 'guest';
  userEmail: string | null;
  socketId: string;
  joinedAt: string;
  leftAt: string | null;
  isActive: boolean;
}

export interface Recording {
  meetingId: string;
  recordingId: string;
  participantName: string;
  sessionId: string;
  filePath: string;
  s3Url: string | null;
  uploadedAt: string;
  uploadId: string | null;
  status: 'uploading' | 'completed';
}

export interface RecordingState {
  meetingId: string;
  isRecording: boolean;
  startedAt: string | null;
  startedBySocketId: string | null;
  startedByUserId: string | null;
  stoppedAt: string | null;
  sessionId: string | null;
}

export interface Participant {
  socketId: string;
  userId: string;
  role: 'host' | 'guest';
  userEmail: string | null;
}
