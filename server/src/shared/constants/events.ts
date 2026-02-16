/**
 * events.ts — Socket.IO event name constants.
 *
 * Every real-time event flowing through Socket.IO is identified by a
 * string event name. This file centralizes all event names as a frozen
 * object so both the server handlers and the client can share the same
 * constants, preventing typo-related bugs.
 *
 * Event categories:
 *   - Session lifecycle: JOIN_ROOM, ROOM_STATE, USER_JOINED, USER_LEFT, etc.
 *   - WebRTC signaling:  OFFER, ANSWER, ICE_CANDIDATE
 *   - Recording control: START_RECORDING, STOP_RECORDING, RESUME_RECORDING
 *   - Audio quality:     MIC_CHECK, MIC_STATUS, AUDIO_METRICS, RECORDING_WARNING, QUALITY_UPDATE
 *   - File upload:       UPLOAD_PROGRESS, RECORDINGS_UPDATED
 *   - Processing:        PROCESSING_STATUS, PROCESSING_COMPLETE, RECORDING_REJECTED
 *   - Misc:              CHAT_MESSAGE, ERROR
 */
export const SOCKET_EVENTS = {
  // ─── Session Lifecycle ────────────────────────────────────────
  JOIN_ROOM: 'join-room',                 // Client → Server: request to join a meeting room
  ROOM_STATE: 'room-state',               // Server → Client: full room state snapshot after joining
  USER_JOINED: 'user-joined',             // Server → Room: a new participant joined
  USER_LEFT: 'user-left',                 // Server → Room: a participant disconnected
  PEER_RECONNECTED: 'peer-reconnected',   // Server → Room: a peer reconnected with a new socket ID
  ROOM_FULL: 'room-full',                 // Server → Client: room has reached max capacity (2)
  DUPLICATE_SESSION: 'duplicate-session', // Server → Old Tab: same user opened meeting in new tab

  // ─── WebRTC Signaling ─────────────────────────────────────────
  OFFER: 'offer',                         // Bidirectional: SDP offer relay between peers
  ANSWER: 'answer',                       // Bidirectional: SDP answer relay between peers
  ICE_CANDIDATE: 'ice-candidate',         // Bidirectional: ICE candidate relay between peers

  // ─── Recording Control ────────────────────────────────────────
  START_RECORDING: 'start-recording',     // Client → Server (request) / Server → Room (broadcast)
  STOP_RECORDING: 'stop-recording',       // Client → Server (request) / Server → Room (broadcast)
  RESUME_RECORDING: 'resume-recording',   // Server → Reconnecting Client: resume mid-recording

  // ─── Chat ─────────────────────────────────────────────────────
  CHAT_MESSAGE: 'chat-message',           // Bidirectional: text message relay within a room

  // ─── Green Room / Mic Check ───────────────────────────────────
  MIC_CHECK: 'mic-check',                 // Client → Server: send mic metrics for evaluation
  MIC_STATUS: 'mic-status',               // Server → Client: evaluated mic quality result

  // ─── Live Audio Metrics (during recording) ────────────────────
  AUDIO_METRICS: 'audio-metrics',         // Client → Server: periodic audio quality batch (~5s)
  RECORDING_WARNING: 'recording-warning', // Server → Room: real-time quality warning
  QUALITY_UPDATE: 'quality-update',       // Server → Room: updated quality profile estimate

  // ─── Upload Progress ──────────────────────────────────────────
  UPLOAD_PROGRESS: 'upload-progress',     // Client → Server → Room: file upload % relay
  RECORDINGS_UPDATED: 'recordings-updated', // Server → Room: recording entries updated

  // ─── Processing Pipeline ──────────────────────────────────────
  PROCESSING_STATUS: 'processing-status',     // Server → Room: pipeline step progress
  PROCESSING_COMPLETE: 'processing-complete', // Server → Room: pipeline finished successfully
  RECORDING_REJECTED: 'recording-rejected',   // Server → Room: recording quality too low

  // ─── Error ────────────────────────────────────────────────────
  ERROR: 'error',                         // Server → Client: generic error notification
} as const;

/** Union type of all valid socket event name strings */
export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
