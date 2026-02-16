/**
 * requestId.ts — Request tracing middleware.
 *
 * Assigns a unique ID to every incoming HTTP request for log correlation.
 * If the client sends an `x-request-id` header (e.g., from a load balancer
 * or API gateway), that value is reused. Otherwise, a new UUID is generated.
 *
 * The request ID is:
 *   - Attached to req.requestId for use in route handlers
 *   - Stored in a module-level variable (via setRequestId) so the logger
 *     can include it in every log entry during the request lifecycle
 *   - Cleared when the response finishes to avoid leaking across requests
 */
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { setRequestId } from '../utils/logger';

// Extend Express Request globally to include the request ID
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
