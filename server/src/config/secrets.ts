/**
 * config/secrets.ts — AWS Secrets Manager integration.
 *
 * Fetches application secrets stored as a JSON blob in AWS Secrets Manager.
 * The secret is identified by its ID (typically the APP_NAME), and the
 * JSON value is parsed into a key-value map that gets merged into process.env.
 *
 * Example secret structure in AWS:
 *   { "JWT_SECRET": "...", "REDIS_PASSWORD": "...", "DB_CONNECTION_STRING": "..." }
 *
 * Only used in production/stage environments — local dev relies on .env files.
 * Region defaults to ap-south-1 (Mumbai) but can be overridden via AWS_REGION.
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { logger } from '../utils/logger';

// Singleton Secrets Manager client — reused across calls within the same process
const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'ap-south-1',
});

/**
 * Fetches and parses a JSON secret from AWS Secrets Manager.
 * @param secretId — The secret name/ARN (typically APP_NAME like "audio-studio-prod")
 * @returns Key-value pairs from the secret JSON, or empty object if no value found
 */
export async function loadSecrets(secretId: string): Promise<Record<string, string>> {
  logger.info(`Fetching secrets for ID: ${secretId}`);
  const command = new GetSecretValueCommand({ SecretId: secretId });
  const response = await client.send(command);

  if (response.SecretString) {
    return JSON.parse(response.SecretString);
  }

  logger.warn('SecretString is empty for this secret');
  return {};
}
