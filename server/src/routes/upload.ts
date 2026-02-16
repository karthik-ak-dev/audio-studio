/**
 * routes/upload.ts — REST API for simple (single-PUT) audio file uploads.
 *
 * Mounted at /api/upload in server.ts. Used for smaller audio files that
 * can be uploaded in a single HTTP PUT request (vs. the multipart upload
 * route for larger files).
 *
 * Simple upload flow:
 *   1. POST /url      — Client requests a presigned S3 PUT URL
 *                        Server generates an S3 key and returns the presigned URL
 *   2. Client PUTs the audio file directly to S3 using the presigned URL
 *   3. POST /complete — Client notifies the server that the upload finished
 *                        Server verifies the file exists in S3 and creates a
 *                        Recording entry in DynamoDB with status 'completed'
 *
 * No authentication required — the meeting room ID serves as implicit access.
 * The presigned URL is scoped to the specific S3 key and expires after
 * UPLOAD_URL_EXPIRY seconds.
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as uploadService from '../services/uploadService';
import { BUCKET_NAME } from '../infra/s3';

const router = Router();

// POST /api/upload/url — Generate a presigned S3 PUT URL for direct upload
// The client will use this URL to upload the audio file directly to S3,
// bypassing the server (reducing bandwidth and latency).
router.post('/url', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomId, participantName, sessionId, contentType } = req.body;
    const { uploadUrl, key } = await uploadService.generateUploadUrl(
      roomId,
      participantName,
      sessionId,
      contentType,
    );

    res.json({
      uploadUrl,
      key,
      bucket: BUCKET_NAME,
      roomId,
      participantName,
      sessionId: sessionId || null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/upload/complete — Confirm that the file has been uploaded to S3
// Verifies the object exists in S3, then creates a Recording entry in DynamoDB
router.post('/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomId, participantName, key, sessionId } = req.body;
    await uploadService.completeUpload(roomId, participantName, key, sessionId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
