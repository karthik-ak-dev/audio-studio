import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { LIMITS } from '../shared';
import * as uploadService from '../services/uploadService';
import { BUCKET_NAME } from '../infra/s3';
import { multipartLimiter, initiateUploadLimiter } from '../middleware/rateLimit';
import { ValidationError } from '../utils/errors';
import { validatePartNumber } from '../utils/validators';

const router = Router();

// POST /api/multipart-upload/initiate — Start a new multipart upload
router.post('/initiate', initiateUploadLimiter, async (req: Request, res: Response, next: NextFunction) => {
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
      sessionId: null,
      expiresAt: new Date(Date.now() + LIMITS.PRESIGNED_URL_EXPIRY * 1000).toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/multipart-upload/part-1 — Get presigned URL for Part 1 (cached in temp folder)
router.post('/part-1', multipartLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { uploadId } = req.body;
    if (!uploadId) throw new ValidationError('uploadId is required');

    const { url, tempKey } = await uploadService.getPart1Url(uploadId);

    res.json({
      url,
      tempKey,
      partNumber: 1,
      cached: true,
      expiresAt: new Date(Date.now() + LIMITS.UPLOAD_URL_EXPIRY * 1000).toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/multipart-upload/part-url — Get presigned URL for a specific part
router.post('/part-url', multipartLimiter, async (req: Request, res: Response, next: NextFunction) => {
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
});

// POST /api/multipart-upload/complete — Complete the multipart upload
router.post('/complete', multipartLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key, uploadId, parts, roomId, participantName, sessionId } = req.body;
    if (!key || !uploadId || !parts || !roomId || !participantName) {
      throw new ValidationError('key, uploadId, parts, roomId, and participantName are required');
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
});

// POST /api/multipart-upload/abort — Abort a multipart upload
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

// GET /api/multipart-upload/parts — List uploaded parts
router.get('/parts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = req.query.key as string;
    const uploadId = req.query.uploadId as string;
    if (!key || !uploadId) throw new ValidationError('key and uploadId query params are required');

    const result = await uploadService.getUploadedParts(key, uploadId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
