/**
 * routes/stats.ts — REST API for global platform statistics.
 *
 * Mounted at /api/stats in server.ts. Returns real-time counters from
 * the GlobalStats DynamoDB table (singleton row with key "GLOBAL").
 *
 *   GET / — Returns { activeSessionCount, activeRecordingCount, activePairCount }
 *
 * Protected by JWT authentication — only the admin dashboard should access this.
 * Counters are maintained atomically via DynamoDB ADD operations in statsRepo
 * (incremented/decremented as sessions join/leave and recordings start/stop).
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as statsRepo from '../repositories/statsRepo';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// GET /api/stats — Returns current global counters (sessions, recordings, pairs)
router.get('/', authMiddleware, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await statsRepo.getStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

export default router;
