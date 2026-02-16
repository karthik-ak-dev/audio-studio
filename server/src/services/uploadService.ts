import type { Recording } from '../shared';
import { LIMITS } from '../shared';
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
    status: 'completed',
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
    status: 'uploading',
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
      'completed',
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

function patchWavHeader(header: Buffer, totalDataSize: number): Buffer {
  const patched = Buffer.from(header);
  // Bytes 4-7: ChunkSize = totalDataSize - 8 (entire file size minus RIFF header)
  patched.writeUInt32LE(totalDataSize - 8, 4);
  // Bytes 40-43: Subchunk2Size = totalDataSize - 44 (raw audio data size)
  patched.writeUInt32LE(totalDataSize - 44, 40);
  return patched;
}
