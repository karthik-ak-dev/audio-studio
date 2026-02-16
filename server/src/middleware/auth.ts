/**
 * auth.ts — JWT authentication middleware and token utilities.
 *
 * Provides three exports:
 *   - authMiddleware: Express middleware that validates Bearer tokens on protected routes
 *   - generateToken:  Creates a JWT with userId + email (24-hour expiry)
 *   - verifyToken:    Standalone token verification (used outside Express context)
 *
 * In development (ENV=development with no JWT_SECRET), auth is bypassed
 * entirely so developers don't need to manage tokens locally.
 *
 * The middleware extends Express's Request type to include `req.user`
 * with the decoded JWT payload ({ userId, email }).
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// Extend Express Request globally to include the authenticated user payload
declare global {
  namespace Express {
    interface Request {
      user?: { userId: string; email: string };
    }
  }
}

/**
 * Express middleware: extracts and validates the JWT from the Authorization header.
 * On success, attaches decoded user info to req.user and calls next().
 * On failure, returns 401 Unauthorized.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth in development if no JWT_SECRET configured
  if (process.env.ENV === 'development') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
    req.user = decoded;
    next();
  } catch (err) {
    logger.warn('JWT verification failed', { error: (err as Error).message });
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Generate a JWT token with 24-hour expiry containing userId and email */
export function generateToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '24h' });
}

/** Verify a JWT token and return the payload, or null if invalid/expired */
export function verifyToken(token: string): { userId: string; email: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
  } catch {
    return null;
  }
}
