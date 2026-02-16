/**
 * constants/limits.ts — System-wide limits and configuration constants.
 *
 * These values are shared between client and server to ensure consistent
 * validation. Changing a value here affects both sides at compile time.
 *
 * ## Categories
 *
 * - **Room limits**: Max 2 participants per room
 * - **File size limits**: S3 upload constraints (5GB max, 5MB–100MB parts)
 * - **URL expiry**: Presigned URL lifetimes for S3 operations
 * - **Socket timing**: Ping interval, timeout, ghost socket delay
 * - **Input validation**: Max lengths for user input fields
 * - **Rate limiting**: Per-endpoint request limits (enforced server-side)
 * - **Content types**: Allowed MIME types for audio/video uploads
 */
export const LIMITS = {
  // ── Room ──────────────────────────────────────────────────────────
  /** Maximum participants per room — enforced by server on join-room */
  MAX_PARTICIPANTS: 2,

  // ── File Size (S3) ────────────────────────────────────────────────
  /** Maximum upload file size — 5GB (S3 single-object limit for presigned PUT) */
  MAX_FILE_SIZE: 5 * 1024 * 1024 * 1024, // 5GB
  /** Minimum S3 multipart part size — 5MB (S3 hard minimum) */
  MIN_PART_SIZE: 5 * 1024 * 1024, // 5MB
  /** Maximum S3 multipart part size — 100MB */
  MAX_PART_SIZE: 100 * 1024 * 1024, // 100MB
  /** Maximum number of parts in a multipart upload (S3 limit: 10,000) */
  MAX_PARTS: 10_000,

  // ── URL Expiry ────────────────────────────────────────────────────
  /** Presigned URL expiry for multipart part uploads — 1 hour (seconds) */
  PRESIGNED_URL_EXPIRY: 3600, // 1 hour
  /** Presigned URL expiry for simple upload — 15 minutes (seconds) */
  UPLOAD_URL_EXPIRY: 900, // 15 minutes

  // ── Socket Timing ─────────────────────────────────────────────────
  /**
   * Delay before treating a disconnected socket as truly gone (ms).
   * Allows brief reconnections (e.g., network blip) without triggering
   * user-left events. Server waits this long before removing the participant.
   */
  GHOST_SOCKET_DELAY_MS: 800,
  /** Socket.IO server ping interval — how often server pings clients (ms) */
  SOCKET_PING_INTERVAL: 10_000,
  /** Socket.IO server ping timeout — disconnect after no pong response (ms) */
  SOCKET_PING_TIMEOUT: 15_000,

  // ── Input Validation ──────────────────────────────────────────────
  /** Maximum meeting title length (characters) */
  TITLE_MAX_LENGTH: 255,
  /** Maximum participant name length (characters) */
  NAME_MAX_LENGTH: 255,

  // ── Rate Limiting (enforced server-side) ──────────────────────────
  /** General API rate limit — 100 requests per window per IP */
  GENERAL_RATE_LIMIT: 100,
  /** Multipart part-url endpoint — 10 requests per second per (IP + uploadId) */
  MULTIPART_RATE_LIMIT: 10,
  /** Multipart initiate endpoint — 100 requests per minute per IP */
  INITIATE_RATE_LIMIT: 100,

  // ── Allowed Content Types ─────────────────────────────────────────
  /**
   * MIME types accepted by the upload endpoints.
   * Server validates Content-Type against this list.
   * Client always uses 'audio/wav' (from recorderService).
   */
  ALLOWED_CONTENT_TYPES: [
    'audio/webm',
    'audio/mp3',
    'audio/wav',
    'audio/ogg',
    'video/webm',
    'video/mp4',
  ] as const,
} as const;

/** Union type of allowed MIME types for upload content */
export type AllowedContentType = (typeof LIMITS.ALLOWED_CONTENT_TYPES)[number];
