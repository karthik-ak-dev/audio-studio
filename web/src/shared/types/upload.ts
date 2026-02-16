/**
 * types/upload.ts — REST API request/response types for S3 upload endpoints.
 *
 * These interfaces define the HTTP request bodies and response shapes for
 * the upload routes. The client's uploadService.ts constructs these payloads
 * and parses the responses.
 *
 * ## Simple Upload Flow (files ≤ 10MB)
 *
 *   POST /api/upload/url       → GetUploadUrlRequest  → GetUploadUrlResponse
 *   PUT  {uploadUrl}           → (raw blob to S3)
 *   POST /api/upload/complete  → UploadCompleteRequest → { success: true }
 *
 * ## Multipart Upload Flow (files > 10MB)
 *
 *   POST /api/multipart-upload/initiate   → InitiateMultipartRequest → InitiateMultipartResponse
 *   POST /api/multipart-upload/part-1     → Part1Request → Part1Response
 *   POST /api/multipart-upload/part-url   → PartUrlRequest → PartUrlResponse (per part)
 *   PUT  {url}                            → (raw blob to S3, returns ETag header)
 *   POST /api/multipart-upload/complete   → CompleteMultipartRequest → CompleteMultipartResponse
 *
 * ## Resume/Abort
 *
 *   GET  /api/multipart-upload/parts      → ListPartsQuery → ListPartsResponse
 *   POST /api/multipart-upload/abort      → AbortMultipartRequest → { success: true }
 */

import type { AllowedContentType } from '../constants/limits';

// ─── Simple Upload ─────────────────────────────────────────────────

/** POST /api/upload/url — Request a presigned S3 PUT URL for simple upload */
export interface GetUploadUrlRequest {
  roomId: string;
  participantName: string;      // userId of the uploader
  sessionId?: string;           // Recording session ID (links to Recording entry)
  contentType?: AllowedContentType; // Defaults to 'audio/wav'
}

/** Response from POST /api/upload/url */
export interface GetUploadUrlResponse {
  uploadUrl: string;            // Presigned S3 PUT URL (15-min expiry)
  key: string;                  // S3 object key (e.g., "recordings/roomId/userId/timestamp.wav")
  bucket: string;               // S3 bucket name
  roomId: string;
  participantName: string;
  sessionId: string | null;
}

/** POST /api/upload/complete — Notify server that simple upload finished */
export interface UploadCompleteRequest {
  roomId: string;
  participantName: string;
  key: string;                  // S3 object key from GetUploadUrlResponse
  sessionId?: string;
}

// ─── Multipart Upload ──────────────────────────────────────────────

/** POST /api/multipart-upload/initiate — Start a new multipart upload */
export interface InitiateMultipartRequest {
  roomId: string;
  participantName: string;
  contentType?: AllowedContentType;
  fileSize?: number;            // Total file size in bytes (for Part 1 temp allocation)
}

/** Response from POST /api/multipart-upload/initiate */
export interface InitiateMultipartResponse {
  uploadId: string;             // S3 multipart upload ID (needed for all subsequent calls)
  key: string;                  // S3 object key
  bucket: string;
  roomId: string;
  participantName: string;
  sessionId: string | null;
  expiresAt: string;            // ISO 8601 — upload must complete before this
}

/**
 * POST /api/multipart-upload/part-1 — Get presigned URL for Part 1 temp copy.
 * Part 1 is special: it's uploaded to both a temp location (for WAV header
 * patching) and the actual multipart upload location.
 */
export interface Part1Request {
  uploadId: string;
}

/** Response from POST /api/multipart-upload/part-1 */
export interface Part1Response {
  url: string;                  // Presigned PUT URL for temp Part 1 location
  tempKey: string;              // S3 key of the temp Part 1 object
  partNumber: 1;                // Always 1
  cached: true;                 // Server caches the tempKey for later header patching
  expiresAt: string;
}

/** POST /api/multipart-upload/part-url — Get presigned URL for a specific part */
export interface PartUrlRequest {
  key: string;                  // S3 object key
  uploadId: string;             // S3 multipart upload ID
  partNumber: number;           // 1-indexed part number
}

/** Response from POST /api/multipart-upload/part-url */
export interface PartUrlResponse {
  url: string;                  // Presigned PUT URL for this part
  partNumber: number;
  expiresAt: string;
}

/**
 * A completed upload part — PartNumber + ETag.
 * The ETag is returned in the S3 PUT response header and is required
 * for the CompleteMultipartUpload S3 API call.
 */
export interface CompletePart {
  PartNumber: number;           // 1-indexed
  ETag: string;                 // From S3 PUT response header (quoted string)
}

/** POST /api/multipart-upload/complete — Finalize the multipart upload */
export interface CompleteMultipartRequest {
  key: string;
  uploadId: string;
  parts: CompletePart[];        // All parts, sorted by PartNumber
  roomId: string;
  participantName: string;
  sessionId?: string;
}

/** Response from POST /api/multipart-upload/complete */
export interface CompleteMultipartResponse {
  success: true;
  location: string;             // Final S3 URL of the assembled object
}

/** POST /api/multipart-upload/abort — Cancel an in-progress multipart upload */
export interface AbortMultipartRequest {
  key: string;
  uploadId: string;
}

/** GET /api/multipart-upload/parts — Query string parameters for listing uploaded parts */
export interface ListPartsQuery {
  key: string;
  uploadId: string;
}

/** Response from GET /api/multipart-upload/parts — used for upload resume */
export interface ListPartsResponse {
  parts: Array<{
    PartNumber: number;
    ETag: string;
    Size: number;               // Part size in bytes
    LastModified: string;       // ISO 8601
  }>;
  totalUploaded: number;        // Sum of all part sizes (for progress calculation)
}
