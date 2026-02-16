import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../utils/logger';

const s3Config: ConstructorParameters<typeof S3Client>[0] = {
  region: process.env.AWS_REGION || 'ap-south-1',
};

if (process.env.AWS_ENDPOINT) {
  s3Config.endpoint = process.env.AWS_ENDPOINT;
  s3Config.forcePathStyle = true;
} else if (process.env.ENV === 'development' && !process.env.KUBERNETES_SERVICE_HOST) {
  s3Config.endpoint = 'http://localhost:4566';
  s3Config.forcePathStyle = true;
}

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  s3Config.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const s3Client = new S3Client(s3Config);

export const BUCKET_NAME = process.env.S3_BUCKET || 'audio-studio-recordings';

// ─── Presigned URLs ─────────────────────────────────────────────

export async function getPresignedPutUrl(
  key: string,
  contentType: string,
  expiresIn: number,
): Promise<string> {
  const command = new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, ContentType: contentType });
  return getSignedUrl(s3Client, command, { expiresIn });
}

export async function getPresignedGetUrl(key: string, expiresIn = 3600): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn });
}

// ─── Object metadata ────────────────────────────────────────────

export async function getObjectMetadata(key: string) {
  try {
    const command = new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key });
    const metadata = await s3Client.send(command);
    return metadata.ContentLength && metadata.ContentLength > 0 ? metadata : null;
  } catch (err: any) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

// ─── Range fetch (for WAV header patching) ──────────────────────

export async function fetchS3Range(key: string, range: string): Promise<Buffer> {
  const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key, Range: range });
  const response = await s3Client.send(command);
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ─── Multipart upload operations ────────────────────────────────

export async function createMultipartUpload(key: string, contentType: string) {
  const command = new CreateMultipartUploadCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  const result = await s3Client.send(command);
  return { uploadId: result.UploadId!, key };
}

export async function getUploadPartUrl(
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn: number,
): Promise<string> {
  const command = new UploadPartCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(s3Client, command, { expiresIn });
}

export async function uploadPartBuffer(
  key: string,
  uploadId: string,
  partNumber: number,
  buffer: Buffer,
) {
  const command = new UploadPartCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
    Body: buffer,
  });
  const result = await s3Client.send(command);
  return { ETag: result.ETag! };
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: Array<{ PartNumber: number; ETag: string }>,
) {
  const command = new CompleteMultipartUploadCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts },
  });
  return s3Client.send(command);
}

export async function abortMultipartUpload(key: string, uploadId: string) {
  const command = new AbortMultipartUploadCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
  });
  await s3Client.send(command);
}

export async function listParts(key: string, uploadId: string) {
  const allParts: Array<{ PartNumber: number; ETag: string; Size: number; LastModified: Date }> = [];
  let isTruncated = true;
  let nextPartNumberMarker: string | undefined;

  while (isTruncated) {
    const command = new ListPartsCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      PartNumberMarker: nextPartNumberMarker,
    });
    const result = await s3Client.send(command);
    if (result.Parts) {
      allParts.push(
        ...result.Parts.map((p) => ({
          PartNumber: p.PartNumber!,
          ETag: p.ETag!,
          Size: p.Size!,
          LastModified: p.LastModified!,
        })),
      );
    }
    isTruncated = result.IsTruncated ?? false;
    nextPartNumberMarker = result.NextPartNumberMarker;
  }
  return allParts;
}

// ─── Key generation ─────────────────────────────────────────────

export function generateS3Key(
  meetingId: string,
  participantName: string,
  extension = '.wav',
  sessionId?: string,
): string {
  const timestamp = Date.now();
  const sanitized = participantName.replace(/[^a-zA-Z0-9\-_]/g, '_');
  if (sessionId) {
    return `recordings/${meetingId}/${sessionId}/${sanitized}_${timestamp}${extension}`;
  }
  return `recordings/${meetingId}/${sanitized}_${timestamp}${extension}`;
}

export function getTempS3Key(uploadId: string): string {
  return `temp_uploads/${uploadId}_part1.wav`;
}

logger.info('S3 client initialized', { bucket: BUCKET_NAME, region: s3Config.region });
