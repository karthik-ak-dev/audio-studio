/**
 * types/socket.ts — Socket.IO event payload interfaces.
 *
 * Defines the TypeScript shape of every Socket.IO message exchanged between
 * the web client and the server. These interfaces ensure type safety at
 * both emit (client → server) and receive (server → client) boundaries.
 *
 * ## Naming Convention
 *
 * - `*Payload` — Data sent by the client (emit) or initial server event data
 * - `*Broadcast` — Data re-broadcast by server to the room (may add fields)
 *
 * ## Direction Guide
 *
 * Client → Server:
 *   JoinRoomPayload, OfferPayload, AnswerPayload, IceCandidatePayload,
 *   StartRecordingPayload, StopRecordingPayload, ChatMessagePayload,
 *   MicCheckPayload, AudioMetricsPayload, UploadProgressPayload
 *
 * Server → Client:
 *   RoomStatePayload, UserJoinedPayload, UserLeftPayload,
 *   PeerReconnectedPayload, RoomFullPayload, DuplicateSessionPayload,
 *   StartRecordingBroadcast, ResumeRecordingPayload,
 *   RecordingsUpdatedPayload, MicStatusPayload, RecordingWarningPayload,
 *   QualityUpdatePayload, ProcessingStatusPayload, ProcessingCompletePayload,
 *   RecordingRejectedPayload, ChatMessageBroadcast, ErrorPayload
 *
 * Relay (Client → Server → Target Client):
 *   OfferPayload, AnswerPayload, IceCandidatePayload
 *   (Server adds `sender` field when relaying)
 */

import type { Meeting, Participant, RecordingState } from './meeting';
import type { QualityProfile } from '../constants/thresholds';

// ─── WebRTC Signaling ──────────────────────────────────────────────

/** SDP description — subset of RTCSessionDescriptionInit */
export interface SDPDescription {
  type: string;                 // 'offer' | 'answer'
  sdp?: string;                 // The SDP blob
}

/** ICE candidate — subset of RTCIceCandidateInit */
export interface ICECandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

// ─── Room Management ───────────────────────────────────────────────

/**
 * Client → Server: Request to join a meeting room.
 * Server validates room exists, checks capacity, then emits room-state.
 */
export interface JoinRoomPayload {
  roomId: string;
  role: 'host' | 'guest';
  userId: string;               // Persistent user ID (generated or from URL param)
  userEmail?: string;           // Optional email for display
}

/**
 * Client → Target: SDP offer for WebRTC connection.
 * Server relays to `target` socket, adding `sender` field.
 */
export interface OfferPayload {
  target: string;               // Target socket ID
  sdp: SDPDescription;
}

/**
 * Client → Target: SDP answer responding to an offer.
 * Server relays to `target` socket, adding `sender` field.
 */
export interface AnswerPayload {
  target: string;               // Target socket ID
  sdp: SDPDescription;
}

/**
 * Client → Target: ICE candidate for NAT traversal.
 * Server relays to `target` socket, adding `sender` field.
 */
export interface IceCandidatePayload {
  target: string;               // Target socket ID
  candidate: ICECandidate;
}

// ─── Recording Control ─────────────────────────────────────────────

/** Client → Server: Host requests recording start */
export interface StartRecordingPayload {
  roomId: string;
}

/** Client → Server: Host requests recording stop */
export interface StopRecordingPayload {
  roomId: string;
}

// ─── Chat ──────────────────────────────────────────────────────────

/** Client → Server: Send a chat message to the room */
export interface ChatMessagePayload {
  roomId: string;
  message: string;
  sender: string;               // Display name or userId
  role: 'host' | 'guest';
}

// ─── Audio Quality (GreenRoom) ─────────────────────────────────────

/**
 * Client → Server: Mic check metrics from GreenRoom.
 * Server evaluates against AUDIO_THRESHOLDS and responds with MicStatusPayload.
 */
export interface MicCheckPayload {
  rms: number;                  // Current RMS level (dBFS)
  peak: number;                 // Peak sample level (dBFS)
  noiseFloor: number;           // Estimated background noise (dBFS)
  isClipping: boolean;          // Whether clipping was detected
}

/**
 * Client → Server: Periodic audio metrics during recording.
 * Server aggregates these for quality estimation and warning detection.
 * Sent every ~1 second by the useAudioMetrics hook.
 */
export interface AudioMetricsPayload {
  timestamp: number;            // Unix timestamp (ms)
  rms: number;                  // Average RMS (dBFS)
  peak: number;                 // Peak level (dBFS)
  clipCount: number;            // Number of clipping events in this batch
  silenceDuration: number;      // Accumulated silence (ms)
  speechDetected: boolean;      // Whether speech was detected in this batch
}

/**
 * Client → Server: Upload progress update.
 * Server relays to the other participant for their UI.
 */
export interface UploadProgressPayload {
  percent: number;              // 0-100
  participantName: string;      // userId of the uploader
}

// ─── Server → Client Payloads ──────────────────────────────────────

/**
 * Server → Client: Complete room state, sent immediately after join-room.
 * Contains everything the client needs to initialize its UI.
 */
export interface RoomStatePayload {
  meeting: Meeting;
  participants: Participant[];
  recordingState: RecordingState;
}

/**
 * Server → Room: A new participant joined.
 * Triggers WebRTC offer creation from existing participant.
 */
export interface UserJoinedPayload {
  userId: string;               // Persistent user ID
  persistentId: string;         // Same as userId (legacy field)
  role: 'host' | 'guest';
  userEmail: string | null;
  isReconnection: boolean;      // True if returning after disconnect
}

/** Server → Room: A participant left (socket disconnected permanently) */
export interface UserLeftPayload {
  userId: string;
  persistentId: string;
  role: 'host' | 'guest';
}

/**
 * Server → Room: A returning participant got a new socket ID.
 * WebRTC connections should be re-established to the new socket.
 */
export interface PeerReconnectedPayload {
  userId: string;
  newSocketId: string;
}

/** Server → Client: Room is at capacity (2 participants) */
export interface RoomFullPayload {
  message: string;
}

/** Server → Client: Same userId already connected in this room */
export interface DuplicateSessionPayload {
  message: string;
}

/**
 * Server → Room: Recording has started.
 * Broadcast to all participants. Contains the new sessionId for
 * linking recordings to this specific recording session.
 */
export interface StartRecordingBroadcast {
  sessionId: string;
}

/**
 * Server → Late Joiner: Recording was already in progress when you joined.
 * Provides elapsed time so the client can show the correct timer offset.
 */
export interface ResumeRecordingPayload {
  startedAt: number;            // Unix timestamp (ms) — when recording started
  elapsedSeconds: number;       // Seconds elapsed since start
  sessionId: string;            // Active recording session ID
}

/** Server → Room: A new recording was uploaded (triggers Results refresh) */
export interface RecordingsUpdatedPayload {
  sessionId: string;
}

/**
 * Server → Client: Mic quality assessment response to mic-check.
 * Returned directly to the sender (not broadcast to room).
 */
export interface MicStatusPayload {
  level: 'good' | 'too-quiet' | 'too-loud';
  noiseFloor: 'clean' | 'noisy' | 'unacceptable';
  clipping: boolean;
  suggestions: string[];        // Human-readable tips (e.g., "Move mic closer")
}

/**
 * Server → Client: Real-time recording quality warning.
 * Displayed as a WarningBanner in the Studio UI.
 */
export interface RecordingWarningPayload {
  type: 'too-loud' | 'too-quiet' | 'clipping' | 'long-silence' | 'noise-increase' | 'overlap';
  speaker: string;              // userId of the affected speaker
  message: string;              // Human-readable warning
  severity: 'warning' | 'critical';
}

/**
 * Server → Room: Updated quality profile estimate.
 * Displayed as a QualityBadge in the Studio UI.
 */
export interface QualityUpdatePayload {
  estimatedProfile: QualityProfile; // P0–P4
  metrics: {
    avgRms: number;             // Average RMS across speakers
    clipCount: number;          // Total clips in session
    overlapPercent: number;     // % of time with simultaneous speech
  };
}

/**
 * Server → Room: Processing pipeline progress update.
 * Published by the SQS consumer as it processes the recording pair.
 */
export interface ProcessingStatusPayload {
  step: 'syncing' | 'validating' | 'classifying' | 'preprocessing' | 'complete';
  progress: number;             // 0-100
  estimatedTimeLeft: number;    // Seconds remaining
}

/**
 * Server → Room: Processing finished successfully.
 * Contains final quality assessment and output file paths.
 */
export interface ProcessingCompletePayload {
  profile: QualityProfile;      // Final quality tier
  metrics: Record<string, number>; // Detailed metrics (SNR, RMS, SRMR, etc.)
  variants: {
    asr?: string;               // ASR transcript S3 key
    annotator?: string;         // Annotator reference S3 key
  };
  warnings: string[];           // Post-processing warnings
}

/**
 * Server → Room: Recording failed the quality gate.
 * The recording pair did not meet minimum quality for the dataset.
 */
export interface RecordingRejectedPayload {
  reason: string;               // Why it was rejected
  suggestions: string[];        // How to improve next time
}

/**
 * Server → Room: Chat message broadcast (with server-added timestamp).
 * The server adds the ISO 8601 timestamp before broadcasting.
 */
export interface ChatMessageBroadcast {
  message: string;
  sender: string;
  role: 'host' | 'guest';
  timestamp: string;            // ISO 8601 — added by server
}

/** Server → Client: Generic error message */
export interface ErrorPayload {
  message: string;
}
