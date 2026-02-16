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
  // Load env + secrets
  await loadConfig();

  // Express app
  const app = express();
  const server = http.createServer(app);

  // Security
  app.use(helmet());
  app.use(cors({ origin: CORS_ORIGINS, credentials: true }));

  // Body parsing
  app.use(express.json({ limit: '1mb' }));

  // Request ID on every request
  app.use(requestIdMiddleware);

  // Rate limiting
  app.use(generalLimiter);

  // Health check (no auth, no rate limit)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // REST API routes
  app.use('/api/meetings', meetingRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/multipart-upload', multipartUploadRoutes);
  app.use('/api/recordings', recordingRoutes);
  app.use('/api/stats', statsRoutes);

  // Global error handler (must be last middleware)
  app.use(errorHandler);

  // Socket.io
  const io = new SocketIOServer(server, {
    cors: { origin: CORS_ORIGINS, credentials: true },
    pingInterval: LIMITS.SOCKET_PING_INTERVAL,
    pingTimeout: LIMITS.SOCKET_PING_TIMEOUT,
    maxHttpBufferSize: 1e6, // 1MB max message size
  });

  // Redis adapter for multi-pod support
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

  // Socket event handlers
  setupSocketHandlers(io);

  // Notification service needs io reference for pushing to clients
  setIOInstance(io);

  // Start SQS consumer for processing results
  startConsumer();

  // Start listening
  server.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`, { env, cors: CORS_ORIGINS });
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);

    // Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // Stop SQS consumer
    stopConsumer();

    // Close all socket connections
    io.close();

    // Disconnect Redis
    await disconnectRedis();

    // Give in-flight requests time to complete
    setTimeout(() => {
      logger.info('Forcing exit after grace period');
      process.exit(0);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Catch unhandled errors
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — shutting down', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', { error: err.message, stack: err.stack });
  process.exit(1);
});
