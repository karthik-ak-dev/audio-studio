/**
 * routes/meetings.ts — REST API endpoints for meeting CRUD operations.
 *
 * Mounted at /api/meetings in server.ts. Provides the full meeting
 * lifecycle management via HTTP:
 *
 *   POST   /                  — Create a new meeting (auth required)
 *   GET    /                  — List all meetings (auth required)
 *   GET    /:id               — Get a specific meeting by ID (public — used by join page)
 *   PATCH  /:id/status        — Update meeting status (auth required)
 *   POST   /:id/assign-host   — Race-safe host email assignment (public — self-serve)
 *   POST   /:id/assign-guest  — Race-safe guest email assignment (public — self-serve)
 *   DELETE /:id               — Delete a meeting (auth required)
 *
 * Auth:
 *   - Create, list, status update, and delete require JWT authentication
 *   - Get-by-ID and assign-host/assign-guest are public (guests need
 *     to access the meeting before authenticating)
 *
 * The assign-host and assign-guest endpoints use DynamoDB conditional
 * expressions for race safety — only the first caller wins if two users
 * try to claim the same slot simultaneously.
 *
 * All errors are forwarded to the global error handler via next(err).
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as meetingService from '../services/meetingService';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// POST /api/meetings — Create a new meeting (requires authentication)
router.post('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meeting = await meetingService.createMeeting(req.body);
    res.status(201).json(meeting);
  } catch (err) {
    next(err);
  }
});

// GET /api/meetings — List all meetings (requires authentication)
router.get('/', authMiddleware, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const meetings = await meetingService.getAllMeetings();
    res.json(meetings);
  } catch (err) {
    next(err);
  }
});

// GET /api/meetings/:id — Get a single meeting by its ID
// Public endpoint — guests use this to fetch meeting details before joining
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meeting = await meetingService.getMeeting(req.params.id as string);
    res.json(meeting);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/meetings/:id/status — Transition meeting status (e.g., active → completed)
router.patch(
  '/:id/status',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await meetingService.updateStatus(req.params.id as string, req.body.status);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/meetings/:id/assign-host — Claim the host slot for this meeting
// Uses a DynamoDB conditional write so only the first caller succeeds (race-safe)
router.post('/:id/assign-host', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assigned = await meetingService.assignHost(req.params.id as string, req.body.email);
    res.json({ assigned });
  } catch (err) {
    next(err);
  }
});

// POST /api/meetings/:id/assign-guest — Claim a guest slot (A or B) for this meeting
// Body: { slot: 'A' | 'B', email: string, name: string }
// Uses a DynamoDB conditional write for race safety
router.post('/:id/assign-guest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slot, email, name } = req.body;
    const assigned = await meetingService.assignGuest(req.params.id as string, slot, email, name);
    res.json({ assigned });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/meetings/:id — Permanently delete a meeting
router.delete(
  '/:id',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await meetingService.deleteMeeting(req.params.id as string);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
