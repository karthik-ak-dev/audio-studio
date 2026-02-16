import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as meetingService from '../services/meetingService';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// POST /api/meetings — Create a new meeting
router.post('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meeting = await meetingService.createMeeting(req.body);
    res.status(201).json(meeting);
  } catch (err) {
    next(err);
  }
});

// GET /api/meetings — List all meetings
router.get('/', authMiddleware, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const meetings = await meetingService.getAllMeetings();
    res.json(meetings);
  } catch (err) {
    next(err);
  }
});

// GET /api/meetings/:id — Get meeting by ID
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meeting = await meetingService.getMeeting(req.params.id as string);
    res.json(meeting);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/meetings/:id/status — Update meeting status
router.patch('/:id/status', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await meetingService.updateStatus(req.params.id as string, req.body.status);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/:id/assign-host — Assign host email (race-safe)
router.post('/:id/assign-host', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assigned = await meetingService.assignHost(req.params.id as string, req.body.email);
    res.json({ assigned });
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/:id/assign-guest — Assign guest email (race-safe)
router.post('/:id/assign-guest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slot, email, name } = req.body;
    const assigned = await meetingService.assignGuest(req.params.id as string, slot, email, name);
    res.json({ assigned });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/meetings/:id — Delete meeting
router.delete('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await meetingService.deleteMeeting(req.params.id as string);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
