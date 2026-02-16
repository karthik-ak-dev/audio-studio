import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { logger } from '../utils/logger';

const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'ap-south-1',
});

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
