/**
 * uploadService.ts — Business logic for audio file uploads.
 *
 * Orchestrates two upload strategies:
 *
 *   1. Simple Upload (small files):
 *      generateUploadUrl → client PUTs to S3 → completeUpload
 *      Creates a Recording entry with status 'completed' immediately.
 *
 *   2. Multipart Upload (large files up to 5GB):
 *      initiateMultipart → getPart1Url (temp cache) → getPartUrl (×N)
 *      → completeMultipart (with WAV header patching) → Recording status 'completed'
 *
 * WAV Header Patching (multipart only):
 *   WAV files have a header (first 44 bytes) that includes the total file size.
 *   When streaming a recording, the client doesn't know the final size upfront.
 *   Part 1 is initially uploaded to a temp S3 location. On completion, we:
 *     1. Fetch the 44-byte header from the temp location
 *     2. Calculate total size from all parts
 *     3. Patch bytes 4-7 (ChunkSize) and 40-43 (Subchunk2Size)
 *     4. Re-upload the patched header as Part 1 of the real multipart upload
 *     5. Complete the multipart upload with the corrected Part 1
 */
import type { Recording } from '../shared';
import { LIMITS, RECORDING_STATUS } from '../shared';
import * as s3 from '../infra/s3';
import * as recordingRepo from '../repositories/recordingRepo';
import { ValidationError, NotFoundError } from '../utils/errors';
import { validateContentType, validateFileSize, sanitizeParticipantName } from '../utils/validators';
import { logger } from '../utils/logger';

// ─── Simple Upload ────────────────────────────────────────────────

export async function generateUploadUrl(
  roomId: string,
  participantName: string,
  sessionId?: string,
  contentType?: string,
): Promise<{ uploadUrl: string; key: string }> {
  const ct = contentType || 'audio/wav';
  if (!validateContentType(ct)) {
    throw new ValidationError(`Invalid content type: ${ct}`);
  }

  const key = s3.generateS3Key(roomId, participantName, '.wav', sessionId);
  const uploadUrl = await s3.getPresignedPutUrl(key, ct, LIMITS.UPLOAD_URL_EXPIRY);

  return { uploadUrl, key };
}

export async function completeUpload(
  roomId: string,
  participantName: string,
  key: string,
  sessionId?: string,
): Promise<void> {
  // Verify the object exists in S3
  const metadata = await s3.getObjectMetadata(key);
  if (!metadata) {
    throw new NotFoundError(`File not found at key: ${key}`);
  }

  const recordingId = sessionId
    ? `${sessionId}#${sanitizeParticipantName(participantName)}`
    : `nosession#${sanitizeParticipantName(participantName)}`;

  const recording: Recording = {
    meetingId: roomId,
    recordingId,
    participantName,
    sessionId: sessionId || '',
    filePath: key,
    s3Url: null,
    uploadedAt: new Date().toISOString(),
    uploadId: null,
    status: RECORDING_STATUS.COMPLETED,
  };

  await recordingRepo.createRecording(recording);
  logger.info('Upload completed', { roomId, participantName, key });
}

// ─── Multipart Upload ─────────────────────────────────────────────

export async function initiateMultipart(
  roomId: string,
  participantName: string,
  contentType?: string,
  fileSize?: number,
): Promise<{ uploadId: string; key: string }> {
  const ct = contentType || 'audio/wav';
  if (!validateContentType(ct)) {
    throw new ValidationError(`Invalid content type: ${ct}`);
  }
  if (fileSize !== undefined && !validateFileSize(fileSize)) {
    throw new ValidationError(`File size exceeds maximum of ${LIMITS.MAX_FILE_SIZE} bytes`);
  }

  const key = s3.generateS3Key(roomId, participantName);
  const result = await s3.createMultipartUpload(key, ct);

  // Create a recording entry in DynamoDB for tracking
  const recordingId = `multipart#${sanitizeParticipantName(participantName)}#${Date.now()}`;
  const recording: Recording = {
    meetingId: roomId,
    recordingId,
    participantName,
    sessionId: '',
    filePath: key,
    s3Url: null,
    uploadedAt: new Date().toISOString(),
    uploadId: result.uploadId,
    status: RECORDING_STATUS.UPLOADING,
  };
  await recordingRepo.createRecording(recording);

  logger.info('Multipart upload initiated', { roomId, participantName, uploadId: result.uploadId });
  return result;
}

export async function getPart1Url(uploadId: string): Promise<{ url: string; tempKey: string }> {
  const tempKey = s3.getTempS3Key(uploadId);
  const url = await s3.getPresignedPutUrl(tempKey, 'audio/wav', LIMITS.UPLOAD_URL_EXPIRY);
  return { url, tempKey };
}

export async function getPartUrl(
  key: string,
  uploadId: string,
  partNumber: number,
): Promise<string> {
  return s3.getUploadPartUrl(key, uploadId, partNumber, LIMITS.UPLOAD_URL_EXPIRY);
}

export async function completeMultipart(
  key: string,
  uploadId: string,
  parts: Array<{ PartNumber: number; ETag: string }>,
  roomId: string,
  participantName: string,
  sessionId?: string,
): Promise<{ location: string }> {
  // WAV header patching: fetch first 44 bytes from temp_uploads, patch the size fields
  const tempKey = s3.getTempS3Key(uploadId);
  try {
    const headerBuffer = await s3.fetchS3Range(tempKey, 'bytes=0-43');

    // Calculate total file size from all parts
    const allParts = await s3.listParts(key, uploadId);
    const totalSize = allParts.reduce((sum, p) => sum + p.Size, 0);

    // Patch WAV header sizes
    const patchedHeader = patchWavHeader(headerBuffer, totalSize);

    // Re-upload Part 1 with patched header
    await s3.uploadPartBuffer(key, uploadId, 1, patchedHeader);

    // Update parts[0] ETag with the new Part 1
    const updatedParts = await s3.listParts(key, uploadId);
    const part1 = updatedParts.find((p) => p.PartNumber === 1);
    if (part1) {
      const idx = parts.findIndex((p) => p.PartNumber === 1);
      if (idx >= 0) parts[idx].ETag = part1.ETag;
    }
  } catch (err) {
    logger.warn('WAV header patching skipped — temp file may not exist', {
      uploadId,
      error: (err as Error).message,
    });
  }

  // Complete the multipart upload
  const result = await s3.completeMultipartUpload(key, uploadId, parts);

  // Update recording status in DynamoDB
  const recording = await recordingRepo.findByUploadId(uploadId);
  if (recording) {
    const recordingId = sessionId
      ? `${sessionId}#${sanitizeParticipantName(participantName)}`
      : recording.recordingId;

    await recordingRepo.updateRecordingStatus(
      roomId,
      recordingId,
      RECORDING_STATUS.COMPLETED,
      result.Location,
    );
  }

  logger.info('Multipart upload completed', { key, uploadId, roomId });
  return { location: result.Location || key };
}

export async function abortMultipart(key: string, uploadId: string): Promise<void> {
  await s3.abortMultipartUpload(key, uploadId);
  logger.info('Multipart upload aborted', { key, uploadId });
}

export async function getUploadedParts(key: string, uploadId: string) {
  const parts = await s3.listParts(key, uploadId);
  const totalUploaded = parts.reduce((sum, p) => sum + p.Size, 0);
  return {
    parts: parts.map((p) => ({
      PartNumber: p.PartNumber,
      ETag: p.ETag,
      Size: p.Size,
      LastModified: p.LastModified.toISOString(),
    })),
    totalUploaded,
  };
}

// ─── WAV Header Patching ──────────────────────────────────────────
// WAV file format (RIFF):
//   Bytes 0-3:   "RIFF"
//   Bytes 4-7:   ChunkSize = totalFileSize - 8 (everything after "RIFF" + size field)
//   Bytes 8-11:  "WAVE"
//   ...          (format chunk, etc.)
//   Bytes 36-39: "data"
//   Bytes 40-43: Subchunk2Size = raw audio data size (totalFileSize - 44)
//   Bytes 44+:   actual audio samples

/** Patch the WAV header with the correct total file size after all parts are known */
function patchWavHeader(header: Buffer, totalDataSize: number): Buffer {
  const patched = Buffer.from(header);
  // Bytes 4-7: ChunkSize = totalDataSize - 8 (entire file size minus RIFF header)
  patched.writeUInt32LE(totalDataSize - 8, 4);
  // Bytes 40-43: Subchunk2Size = totalDataSize - 44 (raw audio data size)
  patched.writeUInt32LE(totalDataSize - 44, 40);
  return patched;
}
