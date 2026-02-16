import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { setRequestId } from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  req.requestId = requestId;
  setRequestId(requestId);

  _res.on('finish', () => setRequestId(undefined));
  next();
}
