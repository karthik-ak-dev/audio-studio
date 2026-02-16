/**
 * constants/events.ts — Socket.IO event name constants.
 *
 * Defines all Socket.IO event names as a frozen `as const` object, providing:
 * 1. Type-safe event names — typos caught at compile time
 * 2. Single source of truth — shared between client and server
 * 3. IDE autocomplete via `SOCKET_EVENTS.JOIN_ROOM`
 *
 * ## Event Categories
 *
 * ### Room Management
 *   - JOIN_ROOM — Client → Server: Join a meeting room
 *   - ROOM_STATE — Server → Client: Full room state on join
 *   - USER_JOINED — Server → Room: New participant entered
 *   - USER_LEFT — Server → Room: Participant disconnected
 *   - PEER_RECONNECTED — Server → Room: Returning participant got new socket
 *   - ROOM_FULL — Server → Client: Rejected (max 2 participants)
 *   - DUPLICATE_SESSION — Server → Client: Same userId already in room
 *
 * ### WebRTC Signaling (relay-only, server does not inspect payloads)
 *   - OFFER — SDP offer (initiator → responder)
 *   - ANSWER — SDP answer (responder → initiator)
 *   - ICE_CANDIDATE — ICE candidate exchange (bidirectional)
 *
 * ### Recording Control
 *   - START_RECORDING — Host triggers recording start → server broadcasts with sessionId
 *   - STOP_RECORDING — Host triggers recording stop → server broadcasts
 *   - RESUME_RECORDING — Server → late joiner: recording already in progress
 *
 * ### Chat
 *   - CHAT_MESSAGE — Bidirectional text chat within room
 *
 * ### Audio Quality (GreenRoom)
 *   - MIC_CHECK — Client → Server: Send mic test metrics
 *   - MIC_STATUS — Server → Client: Mic quality assessment response
 *
 * ### Audio Metrics (Studio, during recording)
 *   - AUDIO_METRICS — Client → Server: Periodic audio analysis batches
 *   - RECORDING_WARNING — Server → Client: Real-time recording quality warnings
 *   - QUALITY_UPDATE — Server → Client: Estimated quality profile update
 *
 * ### Upload & Processing
 *   - UPLOAD_PROGRESS — Client → Server: Upload percentage (relayed to partner)
 *   - RECORDINGS_UPDATED — Server → Room: New recording uploaded
 *   - PROCESSING_STATUS — Server → Room: Processing pipeline progress
 *   - PROCESSING_COMPLETE — Server → Room: Final quality results
 *   - RECORDING_REJECTED — Server → Room: Recording failed quality gate
 *
 * ### Error
 *   - ERROR — Server → Client: Generic error message
 */
export const SOCKET_EVENTS = {
  // ── Room Management ──────────────────────────────────────────────
  JOIN_ROOM: 'join-room',
  ROOM_STATE: 'room-state',
  USER_JOINED: 'user-joined',
  USER_LEFT: 'user-left',
  PEER_RECONNECTED: 'peer-reconnected',
  ROOM_FULL: 'room-full',
  DUPLICATE_SESSION: 'duplicate-session',

  // ── WebRTC Signaling ─────────────────────────────────────────────
  OFFER: 'offer',
  ANSWER: 'answer',
  ICE_CANDIDATE: 'ice-candidate',

  // ── Recording Control ────────────────────────────────────────────
  START_RECORDING: 'start-recording',
  STOP_RECORDING: 'stop-recording',
  RESUME_RECORDING: 'resume-recording',

  // ── Chat ─────────────────────────────────────────────────────────
  CHAT_MESSAGE: 'chat-message',

  // ── Audio Quality (GreenRoom mic check) ──────────────────────────
  MIC_CHECK: 'mic-check',
  MIC_STATUS: 'mic-status',

  // ── Audio Metrics (Studio, during recording) ─────────────────────
  AUDIO_METRICS: 'audio-metrics',
  RECORDING_WARNING: 'recording-warning',
  QUALITY_UPDATE: 'quality-update',

  // ── Upload & Processing ──────────────────────────────────────────
  UPLOAD_PROGRESS: 'upload-progress',
  RECORDINGS_UPDATED: 'recordings-updated',

  // ── Processing Pipeline ──────────────────────────────────────────
  PROCESSING_STATUS: 'processing-status',
  PROCESSING_COMPLETE: 'processing-complete',
  RECORDING_REJECTED: 'recording-rejected',

  // ── Error ────────────────────────────────────────────────────────
  ERROR: 'error',
} as const;

/**
 * Union type of all valid Socket.IO event name strings.
 * Useful for type-constraining event parameters:
 *   function emit(event: SocketEvent, data: unknown) { ... }
 */
export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
