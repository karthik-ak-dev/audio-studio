/**
 * errorHandler.ts — Global Express error handling middleware.
 *
 * This must be the LAST middleware registered (app.use(errorHandler)) so it
 * catches any error thrown or passed via next(err) from route handlers.
 *
 * Error handling strategy:
 *   - AppError instances (ValidationError, NotFoundError, ConflictError, RateLimitError):
 *     Return the appropriate HTTP status code and error code from the error class.
 *   - Unexpected errors: Log full details (message, stack, path, method, requestId)
 *     and return a generic 500 Internal Server Error to avoid leaking internals.
 */
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  // Unexpected errors
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    requestId: req.requestId,
  });

  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
}
