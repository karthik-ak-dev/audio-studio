/**
 * upload.ts — Type definitions for the file upload REST API.
 *
 * The upload system supports two strategies:
 *
 *   1. Simple Upload — For smaller files (<100MB). The client gets a single
 *      presigned PUT URL and uploads the entire file in one request.
 *      Flow: POST /url → PUT to S3 → POST /complete
 *
 *   2. Multipart Upload — For larger files (up to 5GB). The client initiates
 *      a multipart upload, gets presigned URLs for each part, uploads parts
 *      in parallel, then completes the upload. The server handles WAV header
 *      patching to fix file size fields after all parts are assembled.
 *      Flow: POST /initiate → POST /part-1 → POST /part-url (×N) → POST /complete
 *
 * Both strategies use S3 presigned URLs so the browser uploads directly to S3,
 * keeping audio data off the application server.
 */

import type { AllowedContentType } from '../constants/limits';

// ═══════════════════════════════════════════════════════════════════
// Simple Upload Types (POST /api/upload/*)
// ═══════════════════════════════════════════════════════════════════

/** Request body for POST /api/upload/url — get a presigned upload URL */
export interface GetUploadUrlRequest {
  roomId: string;                   // Meeting ID (used to organize S3 keys)
  participantName: string;          // Display name of the uploader
  sessionId?: string;               // Recording session ID (optional, for path organization)
  contentType?: AllowedContentType; // MIME type (defaults to 'audio/wav')
}

/** Response for POST /api/upload/url */
export interface GetUploadUrlResponse {
  uploadUrl: string;                // Presigned S3 PUT URL (valid for 15 minutes)
  key: string;                      // S3 object key where the file will be stored
  bucket: string;                   // S3 bucket name
  roomId: string;                   // Echo back for client reference
  participantName: string;          // Echo back for client reference
  sessionId: string | null;         // Echo back (null if not provided)
}

/** Request body for POST /api/upload/complete — confirm upload finished */
export interface UploadCompleteRequest {
  roomId: string;                   // Meeting ID
  participantName: string;          // Who uploaded the file
  key: string;                      // S3 key of the uploaded file (returned by /url)
  sessionId?: string;               // Recording session ID
}

// ═══════════════════════════════════════════════════════════════════
// Multipart Upload Types (POST /api/multipart-upload/*)
//
// The multipart upload flow is designed for streaming WAV recordings.
// Part 1 gets special treatment — it's initially uploaded to a temp
// location (temp_uploads/) because the WAV header at the beginning
// of the file doesn't know the final file size. After all parts are
// uploaded, the server patches the WAV header with the correct size
// and re-uploads Part 1 to the final multipart upload.
// ═══════════════════════════════════════════════════════════════════

/** Request body for POST /api/multipart-upload/initiate */
export interface InitiateMultipartRequest {
  roomId: string;                   // Meeting ID
  participantName: string;          // Display name of the uploader
  contentType?: AllowedContentType; // MIME type (defaults to 'audio/wav')
  fileSize?: number;                // Expected file size in bytes (for validation, optional)
}

/** Response for POST /api/multipart-upload/initiate */
export interface InitiateMultipartResponse {
  uploadId: string;                 // S3 multipart upload ID (needed for all subsequent part operations)
  key: string;                      // S3 object key for the final assembled file
  bucket: string;                   // S3 bucket name
  roomId: string;                   // Echo back for client reference
  participantName: string;          // Echo back for client reference
  sessionId: string | null;         // Recording session (null at initiation time)
  expiresAt: string;                // ISO 8601 timestamp when the upload will expire
}

/** Request body for POST /api/multipart-upload/part-1 */
export interface Part1Request {
  uploadId: string;                 // S3 multipart upload ID
}

/**
 * Response for POST /api/multipart-upload/part-1.
 * Part 1 is uploaded to a temporary S3 location (temp_uploads/{uploadId}_part1.wav)
 * because the WAV header needs to be patched later with the correct file size.
 * The `cached: true` flag indicates this is the temp-cached approach.
 */
export interface Part1Response {
  url: string;                      // Presigned PUT URL for the temp location
  tempKey: string;                  // S3 key in temp_uploads/ where Part 1 is cached
  partNumber: 1;                    // Always 1
  cached: true;                     // Indicates this uses the temp-cache approach
  expiresAt: string;                // ISO 8601 expiry for the presigned URL
}

/** Request body for POST /api/multipart-upload/part-url (parts 2+) */
export interface PartUrlRequest {
  key: string;                      // S3 object key (the final file key, not temp)
  uploadId: string;                 // S3 multipart upload ID
  partNumber: number;               // Part number (1–10000)
}

/** Response for POST /api/multipart-upload/part-url */
export interface PartUrlResponse {
  url: string;                      // Presigned PUT URL for this part
  partNumber: number;               // Echo back the part number
  expiresAt: string;                // ISO 8601 expiry for the presigned URL
}

/**
 * Represents a completed part in the multipart upload.
 * After uploading each part, S3 returns an ETag that must be
 * included when completing the multipart upload.
 */
export interface CompletePart {
  PartNumber: number;               // Part number (1-indexed)
  ETag: string;                     // S3 ETag returned after successful part upload
}

/** Request body for POST /api/multipart-upload/complete */
export interface CompleteMultipartRequest {
  key: string;                      // S3 object key
  uploadId: string;                 // S3 multipart upload ID
  parts: CompletePart[];            // All uploaded parts with their ETags
  roomId: string;                   // Meeting ID (for recording entry)
  participantName: string;          // Who uploaded (for recording entry)
  sessionId?: string;               // Recording session ID
}

/** Response for POST /api/multipart-upload/complete */
export interface CompleteMultipartResponse {
  success: true;                    // Always true on success (errors throw)
  location: string;                 // S3 location URL of the assembled file
}

/** Request body for POST /api/multipart-upload/abort */
export interface AbortMultipartRequest {
  key: string;                      // S3 object key
  uploadId: string;                 // S3 multipart upload ID to cancel
}

/** Query params for GET /api/multipart-upload/parts */
export interface ListPartsQuery {
  key: string;                      // S3 object key
  uploadId: string;                 // S3 multipart upload ID
}

/** Response for GET /api/multipart-upload/parts */
export interface ListPartsResponse {
  parts: Array<{
    PartNumber: number;             // Part number (1-indexed)
    ETag: string;                   // S3 ETag
    Size: number;                   // Part size in bytes
    LastModified: string;           // ISO 8601 timestamp of last modification
  }>;
  totalUploaded: number;            // Sum of all part sizes in bytes
}
