export const LIMITS = {
  MAX_PARTICIPANTS: 2,

  MAX_FILE_SIZE: 5 * 1024 * 1024 * 1024, // 5GB
  MIN_PART_SIZE: 5 * 1024 * 1024, // 5MB (S3 minimum)
  MAX_PART_SIZE: 100 * 1024 * 1024, // 100MB
  MAX_PARTS: 10_000,

  PRESIGNED_URL_EXPIRY: 3600, // 1 hour (seconds)
  UPLOAD_URL_EXPIRY: 900, // 15 minutes (seconds)

  GHOST_SOCKET_DELAY_MS: 800,
  SOCKET_PING_INTERVAL: 10_000,
  SOCKET_PING_TIMEOUT: 15_000,

  TITLE_MAX_LENGTH: 255,
  NAME_MAX_LENGTH: 255,

  GENERAL_RATE_LIMIT: 100,
  MULTIPART_RATE_LIMIT: 10,
  INITIATE_RATE_LIMIT: 100,

  ALLOWED_CONTENT_TYPES: [
    'audio/webm',
    'audio/mp3',
    'audio/wav',
    'audio/ogg',
    'video/webm',
    'video/mp4',
  ] as const,
} as const;

export type AllowedContentType = (typeof LIMITS.ALLOWED_CONTENT_TYPES)[number];
