/**
 * redis.ts — Redis client for Socket.IO horizontal scaling.
 *
 * When running multiple server pods behind a load balancer, Socket.IO
 * needs a way to broadcast events across all pods. The Redis adapter
 * uses a pub/sub channel pair to relay socket events between pods.
 *
 * Two separate Redis clients are required:
 *   - pubClient: publishes events to the Redis channel
 *   - subClient: subscribes to receive events from other pods
 *
 * In development (single-pod mode), Redis is optional — the server
 * runs fine without it, but events only reach sockets on the same pod.
 *
 * Clients are lazily initialized (created on first access) and support
 * graceful shutdown via disconnectRedis().
 */
import Redis from 'ioredis';
import { logger } from '../utils/logger';

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null as null, // Required for some adapters
};

let pubClient: Redis | null = null;
let subClient: Redis | null = null;

function createClient(name: string): Redis {
  const client = new Redis(redisConfig);
  client.on('connect', () => logger.info(`Redis ${name} connected`));
  client.on('error', (err) => logger.error(`Redis ${name} error`, { error: err.message }));
  return client;
}

export function getPubClient(): Redis {
  if (!pubClient) pubClient = createClient('publisher');
  return pubClient;
}

export function getSubClient(): Redis {
  if (!subClient) subClient = createClient('subscriber');
  return subClient;
}

export async function connectRedis(): Promise<void> {
  const pub = getPubClient();
  const sub = getSubClient();

  const waitForReady = (client: Redis, name: string) =>
    new Promise<void>((resolve, reject) => {
      if (client.status === 'ready') return resolve();
      const timeout = setTimeout(() => reject(new Error(`${name} connection timeout`)), 10_000);
      client.once('ready', () => { clearTimeout(timeout); resolve(); });
      client.once('error', (err) => { clearTimeout(timeout); reject(err); });
    });

  await Promise.all([waitForReady(pub, 'Publisher'), waitForReady(sub, 'Subscriber')]);
  logger.info('Redis connections established');
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all([
    pubClient?.quit().catch(() => {}),
    subClient?.quit().catch(() => {}),
  ]);
  pubClient = null;
  subClient = null;
}
