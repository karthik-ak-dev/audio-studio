/**
 * socket.ts — Type definitions for all Socket.IO event payloads.
 *
 * Every socket event emitted or received by the server has a corresponding
 * payload interface defined here. This ensures type safety across the
 * real-time communication layer.
 *
 * Events are grouped into categories:
 *   1. WebRTC Signaling — SDP offer/answer exchange and ICE candidate relay
 *   2. Session Management — join/leave/reconnect room state
 *   3. Recording Control — start/stop/resume recording
 *   4. Audio Quality — mic check, live metrics warnings, quality profiles
 *   5. Upload Progress — file upload progress relay
 *   6. Processing Pipeline — async processing status and results
 *   7. Chat — simple text message relay
 *   8. Error — generic error payloads
 *
 * The event names themselves are defined in ../constants/events.ts (SOCKET_EVENTS).
 * These payload types define the shape of the data sent with each event.
 */

import type { Meeting, Participant, RecordingState } from './meeting';
import type { QualityProfile } from '../constants/thresholds';

// ═══════════════════════════════════════════════════════════════════
// 1. WebRTC Signaling Payloads
//    Used for peer-to-peer connection setup between participants.
//    The server acts as a relay — it does NOT process these payloads,
//    just forwards them to the target socket.
// ═══════════════════════════════════════════════════════════════════

/** WebRTC Session Description Protocol (SDP) object */
export interface SDPDescription {
  type: string;      // 'offer' or 'answer'
  sdp?: string;      // The SDP string containing codec/media negotiation details
}

/** WebRTC Interactive Connectivity Establishment (ICE) candidate */
export interface ICECandidate {
  candidate?: string;             // The ICE candidate string (network path info)
  sdpMid?: string | null;        // Media stream identification tag
  sdpMLineIndex?: number | null;  // Index of the media description in the SDP
  usernameFragment?: string | null; // ICE username fragment for this candidate
}

// ═══════════════════════════════════════════════════════════════════
// 2. Session Management Payloads
//    Sent when users join/leave rooms and during reconnection flows.
// ═══════════════════════════════════════════════════════════════════

/** Client → Server: Request to join a meeting room */
export interface JoinRoomPayload {
  roomId: string;                 // Meeting ID to join (becomes the Socket.IO room)
  role: 'host' | 'guest';        // Participant's role
  userId: string;                 // Persistent user ID (survives tab refreshes)
  userEmail?: string;             // Optional email for participant identification
}

/** Server → Client: WebRTC offer relay (sender field added by server) */
export interface OfferPayload {
  target: string;                 // Socket ID of the recipient
  sdp: SDPDescription;           // The SDP offer from the sender
}

/** Server → Client: WebRTC answer relay (sender field added by server) */
export interface AnswerPayload {
  target: string;                 // Socket ID of the recipient
  sdp: SDPDescription;           // The SDP answer from the sender
}

/** Server → Client: ICE candidate relay (sender field added by server) */
export interface IceCandidatePayload {
  target: string;                 // Socket ID of the recipient
  candidate: ICECandidate;        // The ICE candidate to relay
}

/** Client → Server: Request to start recording */
export interface StartRecordingPayload {
  roomId: string;                 // Meeting ID where recording should start
}

/** Client → Server: Request to stop recording */
export interface StopRecordingPayload {
  roomId: string;                 // Meeting ID where recording should stop
}

/** Client → Server: Chat message */
export interface ChatMessagePayload {
  roomId: string;                 // Meeting ID (target room)
  message: string;                // Message text content
  sender: string;                 // Display name of the sender
  role: 'host' | 'guest';        // Sender's role
}

// ═══════════════════════════════════════════════════════════════════
// 3. Audio Quality Payloads
//    Used for pre-recording mic checks (green room) and live audio
//    metrics during active recording sessions.
// ═══════════════════════════════════════════════════════════════════

/** Client → Server: Mic check metrics from the green room */
export interface MicCheckPayload {
  rms: number;                    // Root Mean Square volume level (dBFS, typically -60 to 0)
  peak: number;                   // Peak amplitude (dBFS)
  noiseFloor: number;             // Background noise level (dBFS, lower = quieter)
  isClipping: boolean;            // Whether the audio signal is clipping (distortion)
}

/**
 * Client → Server: Audio metrics batch sent periodically (~every 5s) during recording.
 * Each batch summarizes the audio characteristics over that time window.
 */
export interface AudioMetricsPayload {
  timestamp: number;              // Unix timestamp (ms) when this batch was captured
  rms: number;                    // Average RMS volume (dBFS)
  peak: number;                   // Peak amplitude in this window (dBFS)
  clipCount: number;              // Number of clipping events detected
  silenceDuration: number;        // Cumulative silence duration in this window (ms)
  speechDetected: boolean;        // Whether speech was detected in this window
}

/** Client → Server: Upload progress update relayed to other participants */
export interface UploadProgressPayload {
  percent: number;                // Upload completion percentage (0-100)
  participantName: string;        // Name of the participant uploading
}

// ═══════════════════════════════════════════════════════════════════
// 4. Server → Client Event Payloads
//    These are emitted by the server to inform clients about room
//    state changes, recording events, and processing results.
// ═══════════════════════════════════════════════════════════════════

/**
 * Server → Joining Client: Full room state snapshot sent immediately
 * after a user joins or reconnects. Contains everything the client
 * needs to render the current room UI.
 */
export interface RoomStatePayload {
  meeting: Meeting;               // Full meeting details from DynamoDB
  participants: Participant[];    // Currently connected participants
  recordingState: RecordingState; // Whether recording is active and who started it
}

/** Server → Room: A new user has joined the room */
export interface UserJoinedPayload {
  userId: string;                 // Socket ID of the new user (used as WebRTC target)
  persistentId: string;           // Persistent user ID (survives reconnects)
  role: 'host' | 'guest';        // Role of the joining user
  userEmail: string | null;       // Email if provided
  isReconnection: boolean;        // True if this is a reconnect (not a first-time join)
}

/** Server → Room: A user has left the room */
export interface UserLeftPayload {
  userId: string;                 // Socket ID of the departing user
  persistentId: string;           // Persistent user ID
  role: 'host' | 'guest';        // Role of the departing user
}

/**
 * Server → Room: A peer has reconnected with a new socket ID.
 * The remaining participant should tear down the old RTCPeerConnection
 * and create a new one targeting the new socket ID.
 */
export interface PeerReconnectedPayload {
  userId: string;                 // Persistent user ID of the reconnected peer
  newSocketId: string;            // New socket ID to target for WebRTC signaling
}

/** Server → Client: Room is at maximum capacity (2 participants) */
export interface RoomFullPayload {
  message: string;                // Human-readable rejection message
}

/**
 * Server → Old Tab: Sent to the previous tab/socket when the same user
 * opens the meeting in a new tab. The old tab should display a
 * "session opened elsewhere" message and stop.
 */
export interface DuplicateSessionPayload {
  message: string;                // Human-readable message for the old tab
}

/** Server → Room: Recording has started; includes the new session ID */
export interface StartRecordingBroadcast {
  sessionId: string;              // UUID identifying this recording session
}

/**
 * Server → Reconnecting Client: Sent when a user reconnects during an
 * active recording so the client can resume its local recording from
 * the correct point.
 */
export interface ResumeRecordingPayload {
  startedAt: number;              // Unix timestamp (ms) when recording originally started
  elapsedSeconds: number;         // Seconds elapsed since recording started
  sessionId: string;              // Current recording session ID
}

/** Server → Room: Recordings have been updated (e.g., upload completed) */
export interface RecordingsUpdatedPayload {
  sessionId: string;              // Recording session that was updated
}

// ═══════════════════════════════════════════════════════════════════
// 5. Audio Quality Feedback Payloads (Server → Client)
// ═══════════════════════════════════════════════════════════════════

/**
 * Server → Client: Result of a mic check evaluation.
 * Sent back to the user who requested the check and also
 * broadcast to others in the room so they can see partner status.
 */
export interface MicStatusPayload {
  level: 'good' | 'too-quiet' | 'too-loud';       // Volume classification
  noiseFloor: 'clean' | 'noisy' | 'unacceptable'; // Background noise classification
  clipping: boolean;              // Whether audio is clipping
  suggestions: string[];          // Human-readable improvement suggestions
}

/**
 * Server → Room: A recording quality warning detected during live metrics.
 * These are real-time alerts (e.g., "Speaker is clipping") that the
 * UI can display as toast notifications.
 */
export interface RecordingWarningPayload {
  type: 'too-loud' | 'too-quiet' | 'clipping' | 'long-silence' | 'noise-increase' | 'overlap';
  speaker: string;                // Who triggered the warning (email or userId)
  message: string;                // Human-readable warning message
  severity: 'warning' | 'critical'; // Severity level for UI styling
}

/**
 * Server → Room: Periodic quality profile update based on aggregated
 * live metrics. Gives participants a real-time estimate of the
 * recording quality profile (P0 = best, P4 = worst).
 */
export interface QualityUpdatePayload {
  estimatedProfile: QualityProfile; // Estimated quality tier (P0–P4)
  metrics: {
    avgRms: number;               // Average RMS across all speakers
    clipCount: number;            // Total clip events across all speakers
    overlapPercent: number;       // Estimated speaker overlap percentage
  };
}

// ═══════════════════════════════════════════════════════════════════
// 6. Processing Pipeline Payloads (Server → Client)
//    Sent when the async audio processing pipeline (via SQS) reports
//    progress or completion.
// ═══════════════════════════════════════════════════════════════════

/** Server → Room: Processing pipeline progress update */
export interface ProcessingStatusPayload {
  step: 'syncing' | 'validating' | 'classifying' | 'preprocessing' | 'complete';
  progress: number;               // Completion percentage (0-100)
  estimatedTimeLeft: number;      // Seconds until completion estimate
}

/**
 * Server → Room: Processing pipeline has finished successfully.
 * Contains the final quality profile, detailed metrics, and
 * output variants (e.g., ASR transcript, annotator output).
 */
export interface ProcessingCompletePayload {
  profile: QualityProfile;        // Final quality classification (P0–P4)
  metrics: Record<string, number>; // Detailed audio metrics (SNR, RMS, SRMR, etc.)
  variants: {
    asr?: string;                 // Path to ASR (Automatic Speech Recognition) output
    annotator?: string;           // Path to annotator output
  };
  warnings: string[];             // Any warnings from the processing pipeline
}

/**
 * Server → Room: Recording was rejected by the processing pipeline
 * due to quality being too low. Includes the reason and suggestions
 * for re-recording.
 */
export interface RecordingRejectedPayload {
  reason: string;                 // Why the recording was rejected
  suggestions: string[];          // How to improve for the next attempt
}

// ═══════════════════════════════════════════════════════════════════
// 7. Chat & Error Payloads
// ═══════════════════════════════════════════════════════════════════

/** Server → Room: Chat message broadcast (timestamp added server-side) */
export interface ChatMessageBroadcast {
  message: string;                // Message text
  sender: string;                 // Display name of the sender
  role: 'host' | 'guest';        // Sender's role
  timestamp: string;              // ISO 8601 timestamp (added by server)
}

/** Server → Client: Generic error payload */
export interface ErrorPayload {
  message: string;                // Human-readable error description
}
