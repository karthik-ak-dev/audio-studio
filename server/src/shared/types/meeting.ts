/**
 * meeting.ts — Core domain models for the Audio Studio platform.
 *
 * These interfaces define the shape of data stored in DynamoDB and
 * exchanged between server layers. They are the canonical "model types"
 * that every repository, service, and socket handler references.
 *
 * DynamoDB tables that use these types:
 *   - AudioStudio_Meetings       → Meeting        (PK: meetingId)
 *   - AudioStudio_Sessions       → Session         (PK: meetingId, SK: sessionId)
 *   - AudioStudio_Recordings     → Recording       (PK: meetingId, SK: recordingId)
 *   - AudioStudio_RecordingState → RecordingState   (PK: meetingId)
 *
 * Participant is an ephemeral in-memory type used only when building
 * the current list of connected users for a room.
 */

// ─── Meeting Status Lifecycle ─────────────────────────────────────
// A meeting transitions through these statuses:
//   scheduled → active (when first user joins via socket)
//             → recording (when host starts recording)
//             → active (when recording stops)
//             → completed (when session ends)
//   At any point it can also be → cancelled.
export const MEETING_STATUSES = [
  'scheduled',
  'active',
  'recording',
  'completed',
  'cancelled',
] as const;

export type MeetingStatus = (typeof MEETING_STATUSES)[number];

// ─── Meeting ──────────────────────────────────────────────────────
// Represents a scheduled or in-progress recording session between
// a host and one guest. Each meeting has a unique ID and
// tracks the email assignments for participants.
//
// DynamoDB Table: AudioStudio_Meetings
// Primary Key:    meetingId (partition key, no sort key)
export interface Meeting {
  meetingId: string;            // UUID — unique identifier for the meeting
  title: string;                // Human-readable meeting title (max 255 chars)
  hostName: string | null;      // Display name for the host
  hostEmail: string | null;     // Email of the host; null until assigned
  guestName: string | null;     // Display name for the guest
  guestEmail: string | null;    // Email for the guest; null until assigned
  scheduledTime: string | null; // ISO 8601 timestamp for when the meeting is scheduled
  status: MeetingStatus;        // Current lifecycle status
  createdAt: string;            // ISO 8601 timestamp when the meeting was created
}

// ─── Session ──────────────────────────────────────────────────────
// Tracks a single user's connection to a meeting room. One meeting
// can have multiple sessions over time (e.g., if a user disconnects
// and reconnects). The sessionId is a composite of userId + joinedAt
// to keep sessions unique per user per join attempt.
//
// DynamoDB Table: AudioStudio_Sessions
// Primary Key:    meetingId (partition) + sessionId (sort)
// GSIs:           UserIndex (userId) — for reconnection lookup
//                 SocketIndex (socketId) — for disconnect cleanup
export interface Session {
  meetingId: string;                // FK → Meeting.meetingId
  sessionId: string;                // Composite key: `${userId}#${joinedAt}`
  userId: string;                   // Persistent user identifier (survives reconnects)
  userRole: 'host' | 'guest';      // Role in the meeting
  userEmail: string | null;         // User's email, if provided
  socketId: string;                 // Current Socket.IO socket ID (changes on reconnect)
  joinedAt: string;                 // ISO 8601 timestamp when the session started
  leftAt: string | null;            // ISO 8601 timestamp when the user left (null if still active)
  isActive: boolean;                // Whether the session is currently connected
}

// ─── Recording ────────────────────────────────────────────────────
// Represents a single audio recording file uploaded by one participant.
// Each recording session (identified by sessionId) is expected to
// produce exactly 2 recordings — one from the host and one from the guest.
// The recordingId encodes who recorded it: `{sessionId}#{participantName}`.
//
// DynamoDB Table: AudioStudio_Recordings
// Primary Key:    meetingId (partition) + recordingId (sort)
// GSI:            UploadIndex (uploadId) — for finding recordings by S3 multipart uploadId
export interface Recording {
  meetingId: string;              // FK → Meeting.meetingId
  recordingId: string;            // Composite: `{sessionId}#{sanitizedParticipantName}` or `multipart#...`
  participantName: string;        // Display name of the person who recorded
  sessionId: string;              // Recording session ID (links host + guest recordings together)
  filePath: string;               // S3 key where the audio file is stored
  s3Url: string | null;           // Full S3 URL after multipart upload completes
  uploadedAt: string;             // ISO 8601 timestamp when the upload was initiated
  uploadId: string | null;        // S3 multipart upload ID (null for simple uploads)
  status: 'uploading' | 'completed'; // Upload lifecycle status
}

// ─── RecordingState ───────────────────────────────────────────────
// Tracks whether a meeting room is currently recording. This is a
// singleton per meeting — there can only be one active recording at
// a time. Used to coordinate start/stop across participants and to
// resume recording state when a user reconnects mid-recording.
//
// DynamoDB Table: AudioStudio_RecordingState
// Primary Key:    meetingId (partition key, no sort key)
export interface RecordingState {
  meetingId: string;              // FK → Meeting.meetingId
  isRecording: boolean;           // Whether recording is currently active
  startedAt: string | null;       // ISO 8601 timestamp when recording started
  startedBySocketId: string | null; // Socket ID of the user who started recording
  startedByUserId: string | null;   // Persistent user ID of the user who started recording
  stoppedAt: string | null;       // ISO 8601 timestamp when recording was stopped
  sessionId: string | null;       // UUID identifying this recording session (groups host+guest files)
}

// ─── Participant ──────────────────────────────────────────────────
// Ephemeral type used when building the current list of connected
// users in a room. Built from active Session records and sent to
// clients via the ROOM_STATE socket event. Not persisted directly.
export interface Participant {
  socketId: string;               // Current Socket.IO socket ID
  userId: string;                 // Persistent user identifier
  role: 'host' | 'guest';        // Role in the meeting
  userEmail: string | null;       // User's email, if provided
}
