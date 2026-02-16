import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as uploadService from '../services/uploadService';
import { BUCKET_NAME } from '../infra/s3';

const router = Router();

// POST /api/upload/url — Get a presigned upload URL
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

// POST /api/upload/complete — Mark an upload as complete
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
