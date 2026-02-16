/**
 * utils/errors.ts — Application error class hierarchy.
 *
 * Defines structured error types that carry HTTP status codes and
 * machine-readable error codes. The global error handler middleware
 * (middleware/errorHandler.ts) catches these and returns appropriate
 * HTTP responses to the client.
 *
 * Hierarchy:
 *   Error (native)
 *     └── AppError (base — any HTTP-aware error)
 *           ├── ValidationError  (400 — bad input, missing fields)
 *           ├── NotFoundError    (404 — resource doesn't exist)
 *           ├── ConflictError    (409 — duplicate/race condition)
 *           └── RateLimitError   (429 — too many requests)
 *
 * Usage: throw new ValidationError('roomId is required');
 *   → errorHandler catches it and responds with { error: 'roomId is required', code: 'VALIDATION_ERROR' }
 */

/** Base application error — carries an HTTP statusCode and a machine-readable code */
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** 400 Bad Request — invalid input, missing required fields, format errors */
export class ValidationError extends AppError {
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super(message, 400, code);
    this.name = 'ValidationError';
  }
}

/** 404 Not Found — requested resource (meeting, recording, etc.) doesn't exist */
export class NotFoundError extends AppError {
  constructor(message: string, code = 'NOT_FOUND') {
    super(message, 404, code);
    this.name = 'NotFoundError';
  }
}

/** 409 Conflict — resource already exists or race condition (e.g., host slot already claimed) */
export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, 409, code);
    this.name = 'ConflictError';
  }
}

/** 429 Too Many Requests — rate limit exceeded */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests', code = 'RATE_LIMIT_EXCEEDED') {
    super(message, 429, code);
    this.name = 'RateLimitError';
  }
}
