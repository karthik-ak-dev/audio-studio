/**
 * routes/recordings.ts — REST API endpoints for accessing recording metadata and files.
 *
 * Mounted at /api/recordings in server.ts. Provides read-only access to
 * recording data stored in DynamoDB and download URLs via S3 presigned URLs.
 *
 *   GET /:meetingId                          — List all recordings for a meeting
 *   GET /:meetingId/session/:sessionId       — List recordings for a specific session
 *                                              (a session groups host + guest recordings)
 *   GET /:meetingId/download/:recordingId    — Get a time-limited S3 download URL
 *
 * All endpoints are public (no auth required) — the meetingId serves as an
 * implicit access token. Download URLs expire after PRESIGNED_URL_EXPIRY seconds.
 *
 * Note: recordingId is URL-encoded in the path because it contains '#' separators
 * (e.g., "sessionId#participantName"), so it must be decoded before lookup.
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as recordingRepo from '../repositories/recordingRepo';
import * as s3 from '../infra/s3';
import { LIMITS } from '../shared';
import { ValidationError } from '../utils/errors';

const router = Router();

// GET /api/recordings/:meetingId — All recordings for a meeting (across all sessions)
router.get('/:meetingId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const recordings = await recordingRepo.getRecordingsByMeeting(
      req.params.meetingId as string,
    );
    res.json(recordings);
  } catch (err) {
    next(err);
  }
});

// GET /api/recordings/:meetingId/session/:sessionId — Recordings for a specific session
// Filters by recordingId prefix (sessionId#) to return only host + guest files from that session
router.get(
  '/:meetingId/session/:sessionId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const recordings = await recordingRepo.getRecordingsBySession(
        req.params.meetingId as string,
        req.params.sessionId as string,
      );
      res.json(recordings);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/recordings/:meetingId/download/:recordingId — Generate a presigned S3 download URL
// The recordingId contains '#' separators so it arrives URL-encoded and needs decoding
router.get(
  '/:meetingId/download/:recordingId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meetingId = req.params.meetingId as string;
      const recordingId = decodeURIComponent(req.params.recordingId as string);

      // Look up the recording to get its S3 file path
      const recordings = await recordingRepo.getRecordingsByMeeting(meetingId);
      const recording = recordings.find((r) => r.recordingId === recordingId);

      if (!recording) {
        throw new ValidationError('Recording not found');
      }

      // Generate a time-limited download URL (expires after PRESIGNED_URL_EXPIRY seconds)
      const downloadUrl = await s3.getPresignedGetUrl(
        recording.filePath,
        LIMITS.PRESIGNED_URL_EXPIRY,
      );

      res.json({ downloadUrl, recording });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
