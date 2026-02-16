import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger';

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
  handler: (_req, res, _next, options) => {
    logger.warn('Multipart rate limit exceeded', { ip: _req.ip, uploadId: _req.body?.uploadId });
    res.status(429).json(options.message);
  },
});

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
