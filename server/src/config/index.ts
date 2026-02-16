/**
 * config/index.ts — Application configuration loader.
 *
 * Bootstraps environment variables in two phases:
 *   1. Loads .env file (for local development and base config)
 *   2. In production/stage, overlays secrets from AWS Secrets Manager
 *      on top of process.env — so downstream code can read DB passwords,
 *      JWT secrets, API keys, etc. from process.env as usual.
 *
 * Called once at server startup (before any infra clients are created).
 * The APP_NAME env var determines which Secrets Manager secret to fetch.
 */
import path from 'path';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';
import { loadSecrets } from './secrets';

export async function loadConfig(): Promise<void> {
  // Phase 1: Load .env file from the server root directory
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });

  const env = process.env.ENV || 'development';
  logger.info(`Initializing configuration for environment: ${env}`);

  // Phase 2: In non-dev environments, overlay AWS Secrets Manager values
  // onto process.env so all modules pick them up transparently.
  if (env === 'production' || env === 'stage') {
    const appName = process.env.APP_NAME;
    if (!appName) {
      throw new Error('APP_NAME environment variable is required in production/stage');
    }
    const secrets = await loadSecrets(appName);
    for (const [key, value] of Object.entries(secrets)) {
      process.env[key] = value as string;
    }
    logger.info(`Secrets loaded from AWS Secrets Manager for ${appName}`);
  }
}
