// Client-side multipart upload service

import {
  saveUploadState,
  getUploadState,
  clearUploadState,
} from './storageService';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
  partNumber: number;
}

export type OnProgress = (progress: UploadProgress) => void;

const PART_SIZE = 10 * 1024 * 1024; // 10MB per part
const CONCURRENT_UPLOADS = 3;

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

  // For larger files, try multipart upload with fallback to simple
  try {
    return await multipartUpload(blob, roomId, participantName, sessionId, onProgress);
  } catch (err) {
    console.warn('Multipart upload failed, falling back to simple upload:', (err as Error).message);
    return simpleUpload(blob, roomId, participantName, sessionId, onProgress);
  }
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
  const stateKey = `upload:${roomId}:${participantName}:${sessionId || 'none'}`;

  let uploadId: string;
  let key: string;
  let completedParts: Array<{ PartNumber: number; ETag: string }> = [];
  const skipPartNumbers = new Set<number>();

  // Check for resumable upload state
  const savedState = await getUploadState(stateKey);
  if (savedState && savedState.blobSize === blob.size) {
    try {
      const serverParts = await fetchUploadedParts(savedState.key, savedState.uploadId);
      uploadId = savedState.uploadId;
      key = savedState.key;
      completedParts = serverParts.parts.map((p: { PartNumber: number; ETag: string }) => ({
        PartNumber: p.PartNumber,
        ETag: p.ETag,
      }));
      for (const p of completedParts) skipPartNumbers.add(p.PartNumber);

      onProgress?.({
        loaded: serverParts.totalUploaded,
        total: blob.size,
        percent: Math.round((serverParts.totalUploaded / blob.size) * 100),
        partNumber: 0,
      });
    } catch {
      // Saved state is stale; start fresh
      await clearUploadState(stateKey);
    }
  }

  // If no resumable state, initiate a new multipart upload
  if (skipPartNumbers.size === 0) {
    const initRes = await fetch(`${API_BASE}/multipart-upload/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, participantName, contentType: 'audio/wav', fileSize: blob.size }),
    });
    const initData = await initRes.json();
    uploadId = initData.uploadId;
    key = initData.key;
    completedParts = [];
  }

  const totalParts = Math.ceil(blob.size / PART_SIZE);

  // Save state for future resume
  await saveUploadState({
    sessionKey: stateKey,
    uploadId: uploadId!,
    key: key!,
    roomId,
    participantName,
    sessionId: sessionId || '',
    totalParts,
    completedParts: [...completedParts],
    blobSize: blob.size,
    createdAt: Date.now(),
  });

  // Upload Part 1 (special: also goes to temp location for WAV header patching)
  if (!skipPartNumbers.has(1)) {
    const part1Blob = blob.slice(0, PART_SIZE);
    const part1Res = await fetch(`${API_BASE}/multipart-upload/part-1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: uploadId! }),
    });
    const { url: part1Url } = await part1Res.json();

    // Upload Part 1 to temp
    await uploadWithProgress(part1Url, part1Blob, 1, blob.size, onProgress);

    // Also upload Part 1 to the actual multipart upload
    const partUrlRes = await fetch(`${API_BASE}/multipart-upload/part-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key!, uploadId: uploadId!, partNumber: 1 }),
    });
    const { url: actualPart1Url } = await partUrlRes.json();
    const etag1 = await uploadPartAndGetEtag(actualPart1Url, part1Blob);
    completedParts.push({ PartNumber: 1, ETag: etag1 });

    // Update saved state
    await saveUploadState({
      sessionKey: stateKey,
      uploadId: uploadId!,
      key: key!,
      roomId,
      participantName,
      sessionId: sessionId || '',
      totalParts,
      completedParts: [...completedParts],
      blobSize: blob.size,
      createdAt: Date.now(),
    });
  }

  // Upload remaining parts concurrently
  const partTasks: Array<() => Promise<{ PartNumber: number; ETag: string }>> = [];

  for (let partNumber = 2; partNumber <= totalParts; partNumber++) {
    if (skipPartNumbers.has(partNumber)) continue;

    const pn = partNumber;
    partTasks.push(async () => {
      const start = (pn - 1) * PART_SIZE;
      const end = Math.min(start + PART_SIZE, blob.size);
      const partBlob = blob.slice(start, end);

      const partRes = await fetch(`${API_BASE}/multipart-upload/part-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key!, uploadId: uploadId!, partNumber: pn }),
      });
      const { url: partUrl } = await partRes.json();

      const etag = await uploadPartAndGetEtag(partUrl, partBlob);

      onProgress?.({
        loaded: end,
        total: blob.size,
        percent: Math.round((end / blob.size) * 100),
        partNumber: pn,
      });

      return { PartNumber: pn, ETag: etag };
    });
  }

  const remainingParts = await runWithConcurrency(partTasks, CONCURRENT_UPLOADS);

  // Update completed parts with results and persist
  completedParts.push(...remainingParts);
  await saveUploadState({
    sessionKey: stateKey,
    uploadId: uploadId!,
    key: key!,
    roomId,
    participantName,
    sessionId: sessionId || '',
    totalParts,
    completedParts: [...completedParts],
    blobSize: blob.size,
    createdAt: Date.now(),
  });

  // Sort parts by number for completion
  completedParts.sort((a, b) => a.PartNumber - b.PartNumber);

  // Complete the multipart upload
  await fetch(`${API_BASE}/multipart-upload/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: key!, uploadId: uploadId!, parts: completedParts, roomId, participantName, sessionId }),
  });

  // Clear saved upload state on success
  await clearUploadState(stateKey);
}

// ─── Helpers ──────────────────────────────────────────────────────

async function fetchUploadedParts(
  key: string,
  uploadId: string,
): Promise<{ parts: Array<{ PartNumber: number; ETag: string; Size: number }>; totalUploaded: number }> {
  const res = await fetch(
    `${API_BASE}/multipart-upload/parts?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`,
  );
  if (!res.ok) throw new Error('Failed to fetch uploaded parts');
  return res.json();
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
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
