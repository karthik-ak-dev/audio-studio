/**
 * server.ts — Application entry point and bootstrap orchestrator.
 *
 * Sets up and starts the Audio Studio backend server. This file wires
 * together all the layers of the application:
 *
 * ─── Bootstrap Sequence ──────────────────────────────────────────
 *   1. Load environment config + AWS secrets (config/index.ts)
 *   2. Create Express app with security middleware (helmet, CORS)
 *   3. Attach middleware pipeline:
 *      requestId → rateLimit → routes → errorHandler
 *   4. Create Socket.IO server with optional Redis adapter
 *   5. Register socket event handlers (session, signaling, recording, etc.)
 *   6. Wire up the notification service (for pushing SQS results to clients)
 *   7. Start the SQS consumer for processing results
 *   8. Begin listening on the configured PORT
 *
 * ─── Graceful Shutdown ───────────────────────────────────────────
 *   On SIGTERM/SIGINT (e.g., Kubernetes pod termination, Ctrl+C):
 *   1. Stop accepting new HTTP connections
 *   2. Stop the SQS consumer
 *   3. Close all WebSocket connections
 *   4. Disconnect Redis clients
 *   5. Wait 10s grace period for in-flight requests, then exit
 *
 * ─── Error Boundaries ───────────────────────────────────────────
 *   - unhandledRejection: logs but doesn't crash (may be transient)
 *   - uncaughtException: logs and exits (unrecoverable state)
 *   - bootstrap failure: logs and exits with code 1
 */
import './env';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { loadConfig } from './config';
import { connectRedis, getPubClient, getSubClient, disconnectRedis } from './infra/redis';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { generalLimiter } from './middleware/rateLimit';
import { logger } from './utils/logger';
import { LIMITS } from './shared';
import meetingRoutes from './routes/meetings';
import uploadRoutes from './routes/upload';
import multipartUploadRoutes from './routes/multipartUpload';
import recordingRoutes from './routes/recordings';
import { setupSocketHandlers } from './socket';
import statsRoutes from './routes/stats';
import { setIOInstance } from './services/notificationService';
import { startConsumer, stopConsumer } from './consumers/processingResultConsumer';

const PORT = parseInt(process.env.PORT || '4000', 10);
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'];

async function bootstrap(): Promise<void> {
  // ─── Phase 1: Configuration ──────────────────────────────────
  // Load .env file + overlay AWS Secrets Manager values (prod/stage only)
  await loadConfig();

  // ─── Phase 2: Express Setup ──────────────────────────────────
  const app = express();
  const server = http.createServer(app);

  // Security headers (XSS protection, content-type sniffing prevention, etc.)
  app.use(helmet());
  // CORS configuration — allow the frontend origin(s) with credentials (cookies)
  app.use(cors({ origin: CORS_ORIGINS, credentials: true }));

  // Parse JSON request bodies (capped at 1MB to prevent abuse)
  app.use(express.json({ limit: '1mb' }));

  // ─── Phase 3: Middleware Pipeline ────────────────────────────
  // Request ID for log correlation (X-Request-Id header)
  app.use(requestIdMiddleware);

  // Global rate limiting (applies to all routes)
  app.use(generalLimiter);

  // Health check endpoint — exempt from auth and rate limiting
  // Used by load balancers and Kubernetes liveness probes
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // ─── Phase 4: REST API Routes ───────────────────────────────
  app.use('/api/meetings', meetingRoutes); // Meeting CRUD
  app.use('/api/upload', uploadRoutes); // Simple single-PUT uploads
  app.use('/api/multipart-upload', multipartUploadRoutes); // Large file multipart uploads
  app.use('/api/recordings', recordingRoutes); // Recording metadata + download URLs
  app.use('/api/stats', statsRoutes); // Dashboard statistics

  // Global error handler — must be registered LAST (Express convention)
  // Catches all errors forwarded via next(err) from route handlers
  app.use(errorHandler);

  // ─── Phase 5: Socket.IO Setup ───────────────────────────────
  const io = new SocketIOServer(server, {
    cors: { origin: CORS_ORIGINS, credentials: true },
    pingInterval: LIMITS.SOCKET_PING_INTERVAL, // How often to ping clients
    pingTimeout: LIMITS.SOCKET_PING_TIMEOUT, // How long to wait for pong before disconnect
    maxHttpBufferSize: 1e6, // 1MB max message size (prevents DoS via large payloads)
  });

  // ─── Phase 6: Redis Adapter (Optional) ──────────────────────
  // In production (multi-pod), Socket.IO needs Redis pub/sub to relay
  // events across pods. In development, single-pod mode works fine.
  const env = process.env.ENV || 'development';
  if (env !== 'development' || process.env.REDIS_HOST) {
    try {
      await connectRedis();
      io.adapter(createAdapter(getPubClient(), getSubClient()));
      logger.info('Socket.io Redis adapter enabled');
    } catch (err) {
      logger.warn('Redis not available — running without adapter (single-pod mode)', {
        error: (err as Error).message,
      });
    }
  } else {
    logger.info('Socket.io running in single-pod mode (no Redis adapter)');
  }

  // Register all socket event handlers (session, signaling, recording, etc.)
  setupSocketHandlers(io);

  // Give the notification service a reference to io so it can push
  // processing results from the SQS consumer to connected clients
  setIOInstance(io);

  // ─── Phase 7: Background Services ───────────────────────────
  // Start polling the SQS results queue for external processing results
  startConsumer();

  // ─── Phase 8: Start Listening ───────────────────────────────
  server.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`, { env, cors: CORS_ORIGINS });
  });

  // ─── Graceful Shutdown Handler ──────────────────────────────
  // Ensures clean resource cleanup on process termination signals
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);

    // 1. Stop accepting new HTTP/WebSocket connections
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // 2. Stop the SQS consumer (no more message polling)
    stopConsumer();

    // 3. Disconnect all WebSocket clients
    io.close();

    // 4. Close Redis pub/sub connections
    await disconnectRedis();

    // 5. Grace period for in-flight requests to complete, then force exit
    setTimeout(() => {
      logger.info('Forcing exit after grace period');
      process.exit(0);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM')); // Kubernetes/Docker termination
  process.on('SIGINT', () => shutdown('SIGINT')); // Ctrl+C in terminal

  // ─── Unhandled Error Boundaries ─────────────────────────────
  // Log but don't crash on unhandled promise rejections (may be transient)
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason });
  });

  // Uncaught exceptions are unrecoverable — log and exit
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — shutting down', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

// ─── Entry Point ─────────────────────────────────────────────────
// Start the server; if bootstrap fails, log the error and exit
bootstrap().catch((err) => {
  logger.error('Failed to start server', { error: err.message, stack: err.stack });
  process.exit(1);
});
