/**
 * routes/multipartUpload.ts — REST API for S3 multipart upload orchestration.
 *
 * Mounted at /api/multipart-upload in server.ts. Used for large audio files
 * (up to 5GB) that exceed the simple PUT upload limit.
 *
 * Multipart upload flow (client-driven, server-coordinated):
 *
 *   1. POST /initiate          — Server creates an S3 multipart upload and
 *                                 returns the uploadId + S3 key
 *   2. POST /part-1            — Special: Part 1 goes to a temp S3 location
 *                                 (because the WAV header needs patching later)
 *   3. POST /part-url          — Get presigned URL for parts 2..N; client PUTs
 *                                 each chunk directly to S3 using the presigned URL
 *   4. POST /complete          — Server patches the WAV header in Part 1,
 *                                 completes the S3 multipart upload, and updates
 *                                 the Recording status to 'completed' in DynamoDB
 *   5. POST /abort             — Cancel an in-progress multipart upload (cleanup)
 *   6. GET  /parts             — List already-uploaded parts (for resume support)
 *
 * Rate limiting:
 *   - /initiate uses a stricter rate limiter (initiateUploadLimiter)
 *   - /part-1, /part-url, /complete use the multipartLimiter
 *   - /abort and /parts are unrestricted
 *
 * All presigned URLs include an expiration timestamp in the response so
 * the client knows when to refresh them.
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { LIMITS } from '../shared';
import * as uploadService from '../services/uploadService';
import { BUCKET_NAME } from '../infra/s3';
import { multipartLimiter, initiateUploadLimiter } from '../middleware/rateLimit';
import { ValidationError } from '../utils/errors';
import { validatePartNumber } from '../utils/validators';

const router = Router();

// POST /api/multipart-upload/initiate — Start a new S3 multipart upload
// Creates the upload in S3 and tracks it in DynamoDB (Recording with status 'uploading')
router.post(
  '/initiate',
  initiateUploadLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { roomId, participantName, contentType, fileSize } = req.body;
      if (!roomId || !participantName) {
        throw new ValidationError('roomId and participantName are required');
      }

      const { uploadId, key } = await uploadService.initiateMultipart(
        roomId,
        participantName,
        contentType,
        fileSize,
      );

      res.json({
        uploadId,
        key,
        bucket: BUCKET_NAME,
        roomId,
        participantName,
        sessionId: null, // Set later during /complete when session context is known
        expiresAt: new Date(Date.now() + LIMITS.PRESIGNED_URL_EXPIRY * 1000).toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/multipart-upload/part-1 — Get presigned URL for Part 1 (temp location)
// Part 1 is uploaded to a temp S3 key because the WAV header (first 44 bytes)
// needs to be patched with the correct total file size during /complete.
// The temp key is in the temp_uploads/ prefix of the same bucket.
router.post(
  '/part-1',
  multipartLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { uploadId } = req.body;
      if (!uploadId) throw new ValidationError('uploadId is required');

      const { url, tempKey } = await uploadService.getPart1Url(uploadId);

      res.json({
        url,
        tempKey,
        partNumber: 1,
        cached: true, // Indicates this part uses the temp caching strategy
        expiresAt: new Date(Date.now() + LIMITS.UPLOAD_URL_EXPIRY * 1000).toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/multipart-upload/part-url — Get presigned URL for parts 2..N
// The client uses the returned URL to PUT each audio chunk directly to S3.
router.post(
  '/part-url',
  multipartLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key, uploadId, partNumber } = req.body;
      if (!key || !uploadId) throw new ValidationError('key and uploadId are required');
      if (!validatePartNumber(partNumber)) {
        throw new ValidationError(`Invalid part number (1-${LIMITS.MAX_PARTS})`);
      }

      const url = await uploadService.getPartUrl(key, uploadId, partNumber);

      res.json({
        url,
        partNumber,
        expiresAt: new Date(Date.now() + LIMITS.UPLOAD_URL_EXPIRY * 1000).toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/multipart-upload/complete — Finalize the multipart upload
// Patches the WAV header, completes the S3 upload, and marks the recording as 'completed'
router.post(
  '/complete',
  multipartLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key, uploadId, parts, roomId, participantName, sessionId } = req.body;
      if (!key || !uploadId || !parts || !roomId || !participantName) {
        throw new ValidationError(
          'key, uploadId, parts, roomId, and participantName are required',
        );
      }

      const result = await uploadService.completeMultipart(
        key,
        uploadId,
        parts,
        roomId,
        participantName,
        sessionId,
      );

      res.json({ success: true, location: result.location });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/multipart-upload/abort — Cancel an in-progress multipart upload
// Removes all uploaded parts from S3 to avoid storage costs for incomplete uploads
router.post('/abort', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key, uploadId } = req.body;
    if (!key || !uploadId) throw new ValidationError('key and uploadId are required');

    await uploadService.abortMultipart(key, uploadId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/multipart-upload/parts — List already-uploaded parts for a given upload
// Useful for resuming an interrupted upload — client can skip already-uploaded parts
router.get('/parts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = req.query.key as string;
    const uploadId = req.query.uploadId as string;
    if (!key || !uploadId)
      throw new ValidationError('key and uploadId query params are required');

    const result = await uploadService.getUploadedParts(key, uploadId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
