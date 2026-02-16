/**
 * rateLimit.ts — Request rate limiting middleware.
 *
 * Three limiters are exported, each targeting different endpoint groups:
 *
 *   1. generalLimiter — Applied globally to all routes.
 *      100 requests/minute per IP. Prevents abuse of any endpoint.
 *
 *   2. multipartLimiter — Applied to multipart upload part-URL endpoints.
 *      10 requests/second per (IP + uploadId). Tighter limit because
 *      these endpoints are called rapidly during chunked uploads.
 *
 *   3. initiateUploadLimiter — Applied to the upload initiation endpoint.
 *      100 requests/minute per IP. Prevents mass-creation of uploads.
 *
 * All limiters return standard RateLimit headers (RateLimit-Limit,
 * RateLimit-Remaining, RateLimit-Reset) and suppress legacy X-RateLimit headers.
 */
import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger';

/** Global rate limiter: 100 requests per minute per IP across all routes */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    logger.warn('Rate limit exceeded', { ip: _req.ip, path: _req.path });
    res.status(429).json(options.message);
  },
});

/** Multipart upload rate limiter: 10 requests/second per (IP + uploadId) */
export const multipartLimiter = rateLimit({
  windowMs: 1000,
  max: 10,
  message: { error: 'Too many upload requests, please slow down.', code: 'UPLOAD_RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uploadId = req.body?.uploadId || req.query?.uploadId || '';
    return `${req.ip}-${uploadId}`;
  },
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  handler: (_req, res, _next, options) => {
    logger.warn('Multipart rate limit exceeded', { ip: _req.ip, uploadId: _req.body?.uploadId });
    res.status(429).json(options.message);
  },
});

/** Upload initiation rate limiter: 100 requests/minute per IP */
export const initiateUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many upload initiations.', code: 'INITIATION_RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    logger.warn('Initiate upload rate limit exceeded', { ip: _req.ip });
    res.status(429).json(options.message);
  },
});
