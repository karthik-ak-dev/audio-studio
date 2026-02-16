import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as recordingRepo from '../repositories/recordingRepo';
import * as s3 from '../infra/s3';
import { LIMITS } from '../shared';
import { ValidationError } from '../utils/errors';

const router = Router();

// GET /api/recordings/:meetingId — List recordings for a meeting
router.get('/:meetingId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const recordings = await recordingRepo.getRecordingsByMeeting(req.params.meetingId as string);
    res.json(recordings);
  } catch (err) {
    next(err);
  }
});

// GET /api/recordings/:meetingId/session/:sessionId — List recordings for a session
router.get('/:meetingId/session/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const recordings = await recordingRepo.getRecordingsBySession(
      req.params.meetingId as string,
      req.params.sessionId as string,
    );
    res.json(recordings);
  } catch (err) {
    next(err);
  }
});

// GET /api/recordings/:meetingId/download/:recordingId — Get download URL
router.get('/:meetingId/download/:recordingId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = req.params.meetingId as string;
    const recordingId = decodeURIComponent(req.params.recordingId as string);

    const recordings = await recordingRepo.getRecordingsByMeeting(meetingId);
    const recording = recordings.find((r) => r.recordingId === recordingId);

    if (!recording) {
      throw new ValidationError('Recording not found');
    }

    const downloadUrl = await s3.getPresignedGetUrl(
      recording.filePath,
      LIMITS.PRESIGNED_URL_EXPIRY,
    );

    res.json({ downloadUrl, recording });
  } catch (err) {
    next(err);
  }
});

export default router;
