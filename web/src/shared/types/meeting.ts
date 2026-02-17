/**
 * types/meeting.ts — Meeting, session, recording, and participant data models.
 *
 * These types mirror the DynamoDB table schemas on the server. The server
 * sends these shapes via REST API responses and Socket.IO payloads.
 *
 * ## DynamoDB Tables (server-side)
 *
 * - **Meetings table** → Meeting interface
 *   PK: meetingId, Status tracking, host + guest participant support
 *
 * - **Sessions table** → Session interface
 *   PK: meetingId, SK: sessionId, Tracks socket connections per user
 *
 * - **Recordings table** → Recording interface
 *   PK: meetingId, SK: recordingId, S3 object references, upload status
 *
 * - **RecordingState table** → RecordingState interface
 *   PK: meetingId, Singleton per room, tracks active recording session
 *
 * ## Usage
 *
 * - Meeting: Displayed on Home (list), used for room validation
 * - Session: Not directly used by client (server-internal bookkeeping)
 * - Recording: Displayed on Results page, download links
 * - RecordingState: Received in room-state payload, controls Start/Stop UI
 * - Participant: Received in room-state and user-joined events
 */

/**
 * Valid meeting lifecycle states.
 * Transitions: scheduled → active → recording → completed
 *                                              → cancelled (from any state)
 */
export const MEETING_STATUSES = [
  'scheduled',
  'active',
  'recording',
  'completed',
  'cancelled',
] as const;

/** Union type of valid meeting statuses */
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/**
 * Meeting — top-level meeting entity from DynamoDB Meetings table.
 *
 * Created via POST /api/meetings. Supports exactly 2 participants
 * (host + guest).
 */
export interface Meeting {
  meetingId: string;
  title: string;
  hostName: string | null;
  hostEmail: string | null;
  guestName: string | null;
  guestEmail: string | null;
  scheduledTime: string | null;
  status: MeetingStatus;
  createdAt: string;             // ISO 8601 timestamp
}

/**
 * Session — per-user socket connection record from DynamoDB Sessions table.
 *
 * Created on join-room, updated on disconnect/reconnect.
 * Not directly consumed by the client but included in shared types
 * for server-side use and potential admin UI.
 */
export interface Session {
  meetingId: string;
  sessionId: string;            // UUID, also used as the recording session ID
  userId: string;               // Persistent user ID (from URL param or generated)
  userRole: 'host' | 'guest';
  userEmail: string | null;
  socketId: string;             // Current Socket.IO socket ID
  joinedAt: string;             // ISO 8601
  leftAt: string | null;        // ISO 8601, set on disconnect
  isActive: boolean;            // False after permanent disconnect
}

/**
 * Recording — uploaded audio file record from DynamoDB Recordings table.
 *
 * Created by POST /api/upload/complete or POST /api/multipart-upload/complete.
 * The `filePath` is the S3 object key; `s3Url` is the full S3 URL.
 * Used on the Results page to display download links.
 */
export interface Recording {
  meetingId: string;
  recordingId: string;          // UUID
  participantName: string;      // userId of the uploader
  sessionId: string;            // Links to the recording session
  filePath: string;             // S3 object key (e.g., "recordings/roomId/userId/session.wav")
  s3Url: string | null;         // Full S3 URL, set after upload completion
  uploadedAt: string;           // ISO 8601
  uploadId: string | null;      // S3 multipart upload ID (null for simple uploads)
  status: 'uploading' | 'completed';
}

/**
 * RecordingState — room-level recording status from DynamoDB RecordingState table.
 *
 * Singleton per room. Tracks whether recording is active, who started it,
 * and the current session ID. Received in `room-state` payload and used
 * to show/hide the recording timer and Start/Stop controls.
 */
export interface RecordingState {
  meetingId: string;
  isRecording: boolean;
  startedAt: string | null;     // ISO 8601 — used for elapsed time display
  startedBySocketId: string | null;
  startedByUserId: string | null;
  stoppedAt: string | null;     // ISO 8601
  sessionId: string | null;     // Active recording session ID
}

/**
 * Participant — currently connected user in a room.
 *
 * Received in room-state and user-joined payloads. The socketId is used
 * as the target for WebRTC signaling (offer/answer/ICE relay).
 */
export interface Participant {
  socketId: string;             // Current Socket.IO socket ID (target for signaling)
  userId: string;               // Persistent user ID
  role: 'host' | 'guest';
  userEmail: string | null;
}
