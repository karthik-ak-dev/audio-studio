import path from 'path';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';
import { loadSecrets } from './secrets';

export async function loadConfig(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });

  const env = process.env.ENV || 'development';
  logger.info(`Initializing configuration for environment: ${env}`);

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
