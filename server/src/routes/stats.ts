import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as statsRepo from '../repositories/statsRepo';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// GET /api/stats — Dashboard metrics
router.get('/', authMiddleware, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await statsRepo.getStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

export default router;
