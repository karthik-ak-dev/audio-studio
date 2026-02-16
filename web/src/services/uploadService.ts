// Client-side multipart upload service

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
  partNumber: number;
}

export type OnProgress = (progress: UploadProgress) => void;

const PART_SIZE = 10 * 1024 * 1024; // 10MB per part

export async function uploadFile(
  blob: Blob,
  roomId: string,
  participantName: string,
  sessionId: string | undefined,
  onProgress?: OnProgress,
): Promise<void> {
  // For small files (< 10MB), use simple upload
  if (blob.size <= PART_SIZE) {
    return simpleUpload(blob, roomId, participantName, sessionId, onProgress);
  }

  // For larger files, use multipart upload
  return multipartUpload(blob, roomId, participantName, sessionId, onProgress);
}

async function simpleUpload(
  blob: Blob,
  roomId: string,
  participantName: string,
  sessionId: string | undefined,
  onProgress?: OnProgress,
): Promise<void> {
  // Get presigned URL
  const res = await fetch(`${API_BASE}/upload/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, participantName, sessionId, contentType: 'audio/wav' }),
  });
  const { uploadUrl, key } = await res.json();

  // Upload to S3
  await uploadWithProgress(uploadUrl, blob, 1, blob.size, onProgress);

  // Notify server of completion
  await fetch(`${API_BASE}/upload/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, participantName, key, sessionId }),
  });
}

async function multipartUpload(
  blob: Blob,
  roomId: string,
  participantName: string,
  sessionId: string | undefined,
  onProgress?: OnProgress,
): Promise<void> {
  // Initiate multipart upload
  const initRes = await fetch(`${API_BASE}/multipart-upload/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, participantName, contentType: 'audio/wav', fileSize: blob.size }),
  });
  const { uploadId, key } = await initRes.json();

  const totalParts = Math.ceil(blob.size / PART_SIZE);
  const completedParts: Array<{ PartNumber: number; ETag: string }> = [];

  // Upload Part 1 to temp location (for WAV header patching)
  const part1Blob = blob.slice(0, PART_SIZE);
  const part1Res = await fetch(`${API_BASE}/multipart-upload/part-1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  });
  const { url: part1Url } = await part1Res.json();

  // Upload Part 1 to temp
  await uploadWithProgress(part1Url, part1Blob, 1, blob.size, onProgress);

  // Also upload Part 1 to the actual multipart upload
  const partUrlRes = await fetch(`${API_BASE}/multipart-upload/part-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, uploadId, partNumber: 1 }),
  });
  const { url: actualPart1Url } = await partUrlRes.json();
  const etag1 = await uploadPartAndGetEtag(actualPart1Url, part1Blob);
  completedParts.push({ PartNumber: 1, ETag: etag1 });

  // Upload remaining parts
  for (let partNumber = 2; partNumber <= totalParts; partNumber++) {
    const start = (partNumber - 1) * PART_SIZE;
    const end = Math.min(start + PART_SIZE, blob.size);
    const partBlob = blob.slice(start, end);

    const partRes = await fetch(`${API_BASE}/multipart-upload/part-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, uploadId, partNumber }),
    });
    const { url: partUrl } = await partRes.json();

    const etag = await uploadPartAndGetEtag(partUrl, partBlob);
    completedParts.push({ PartNumber: partNumber, ETag: etag });

    onProgress?.({
      loaded: end,
      total: blob.size,
      percent: Math.round((end / blob.size) * 100),
      partNumber,
    });
  }

  // Complete the multipart upload
  await fetch(`${API_BASE}/multipart-upload/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, uploadId, parts: completedParts, roomId, participantName, sessionId }),
  });
}

async function uploadWithProgress(
  url: string,
  blob: Blob,
  partNumber: number,
  totalSize: number,
  onProgress?: OnProgress,
): Promise<void> {
  await fetch(url, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': 'audio/wav' },
  });

  onProgress?.({
    loaded: blob.size,
    total: totalSize,
    percent: Math.round((blob.size / totalSize) * 100),
    partNumber,
  });
}

async function uploadPartAndGetEtag(url: string, blob: Blob): Promise<string> {
  const response = await fetch(url, {
    method: 'PUT',
    body: blob,
  });
  return response.headers.get('ETag') || '';
}
