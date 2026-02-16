/**
 * uploadService.ts — Client-side file upload to S3 via server presigned URLs.
 *
 * Handles uploading recorded WAV files to S3, automatically choosing between
 * simple upload (≤10MB) and multipart upload (>10MB) based on file size.
 *
 * ## Simple Upload Flow (files ≤ 10MB)
 *
 * 1. POST /api/upload/url → Get presigned S3 PUT URL (15-min expiry)
 *    Body: { roomId, participantName, sessionId, contentType: 'audio/wav' }
 *    Response: { uploadUrl, key }
 *
 * 2. PUT blob to uploadUrl (direct to S3, bypasses server)
 *
 * 3. POST /api/upload/complete → Mark upload finished in DynamoDB
 *    Body: { roomId, participantName, key, sessionId }
 *    This creates a Recording entry with status='completed' and triggers
 *    `triggerProcessingIfReady()` which checks if both host+guest uploads
 *    are done, then publishes to SQS for processing.
 *
 * ## Multipart Upload Flow (files > 10MB)
 *
 * 1. POST /api/multipart-upload/initiate → Start multipart upload
 *    Body: { roomId, participantName, contentType, fileSize }
 *    Response: { uploadId, key, expiresAt }
 *
 * 2. **Part 1 (special handling):**
 *    POST /api/multipart-upload/part-1 → Get temp presigned URL
 *    Body: { uploadId }
 *    Response: { url, tempKey }
 *    Upload Part 1 to temp location (for WAV header patching later).
 *    ALSO upload Part 1 to the actual multipart upload location.
 *
 *    Why? The WAV header (first 44 bytes) contains ChunkSize and Subchunk2Size
 *    fields that must match the total file size. During streaming recording,
 *    the client doesn't know the final size upfront. The server patches these
 *    fields from the temp copy during multipart completion.
 *
 * 3. **Parts 2-N (parallel):**
 *    POST /api/multipart-upload/part-url → Get presigned URL per part
 *    Body: { key, uploadId, partNumber }
 *    Response: { url }
 *    PUT each 10MB part directly to S3 (3 concurrent uploads)
 *
 * 4. POST /api/multipart-upload/complete → Finalize
 *    Body: { key, uploadId, parts: [{PartNumber, ETag}], roomId, participantName, sessionId }
 *    Server: patches WAV header from temp, completes S3 multipart, creates Recording entry
 *
 * ## Resume Support
 *
 * Upload state (uploadId, completed parts) is persisted in IndexedDB via
 * storageService. If the upload is interrupted:
 * 1. On retry, check IndexedDB for saved state
 * 2. Verify with server: GET /api/multipart-upload/parts?key=...&uploadId=...
 * 3. Skip already-uploaded parts, resume from where we left off
 *
 * ## Fallback
 *
 * If multipart upload fails at any step, falls back to simple upload.
 * This handles edge cases like expired presigned URLs or S3 errors.
 *
 * ## Rate Limiting (server-side)
 *
 * - multipart-upload/part-url: 10 req/sec per (IP + uploadId)
 * - multipart-upload/initiate: 100 req/min per IP
 */

import {
  saveUploadState,
  getUploadState,
  clearUploadState,
} from './storageService';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface UploadProgress {
  loaded: number;       // Bytes uploaded so far
  total: number;        // Total file size in bytes
  percent: number;      // 0-100 integer
  partNumber: number;   // Current part being uploaded (0 for initial state)
}

export type OnProgress = (progress: UploadProgress) => void;

/** Part size for multipart uploads — 10MB (S3 minimum is 5MB) */
const PART_SIZE = 10 * 1024 * 1024;

/** Maximum concurrent part uploads — balances speed vs. browser connection limits */
const CONCURRENT_UPLOADS = 3;

/**
 * Upload a recorded audio blob to S3.
 *
 * Automatically chooses simple or multipart upload based on file size.
 * Multipart upload falls back to simple on failure.
 *
 * @param blob — WAV audio blob from recorderService
 * @param roomId — Meeting room ID
 * @param participantName — User identifier (persistent userId)
 * @param sessionId — Recording session ID from server
 * @param onProgress — Callback for upload progress updates
 */
export async function uploadFile(
  blob: Blob,
  roomId: string,
  participantName: string,
  sessionId: string | undefined,
  onProgress?: OnProgress,
): Promise<void> {
  // Simple upload for small files
  if (blob.size <= PART_SIZE) {
    return simpleUpload(blob, roomId, participantName, sessionId, onProgress);
  }

  // Multipart upload for large files, with simple upload fallback
  try {
    return await multipartUpload(blob, roomId, participantName, sessionId, onProgress);
  } catch (err) {
    console.warn('Multipart upload failed, falling back to simple upload:', (err as Error).message);
    return simpleUpload(blob, roomId, participantName, sessionId, onProgress);
  }
}

/**
 * Simple single-request upload via presigned S3 PUT URL.
 * Used for files ≤10MB or as fallback when multipart fails.
 */
async function simpleUpload(
  blob: Blob,
  roomId: string,
  participantName: string,
  sessionId: string | undefined,
  onProgress?: OnProgress,
): Promise<void> {
  // Step 1: Get presigned PUT URL from server
  const res = await fetch(`${API_BASE}/upload/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, participantName, sessionId, contentType: 'audio/wav' }),
  });
  const { uploadUrl, key } = await res.json();

  // Step 2: Upload directly to S3
  await uploadWithProgress(uploadUrl, blob, 1, blob.size, onProgress);

  // Step 3: Notify server of completion — creates Recording entry + triggers processing
  await fetch(`${API_BASE}/upload/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, participantName, key, sessionId }),
  });
}

/**
 * Multipart upload for large files (>10MB).
 * Splits the blob into 10MB parts, uploads 3 concurrently, with resume support.
 */
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

  // ── Check for resumable upload state in IndexedDB ────────────────
  const savedState = await getUploadState(stateKey);
  if (savedState && savedState.blobSize === blob.size) {
    try {
      // Verify with server that the upload is still valid
      const serverParts = await fetchUploadedParts(savedState.key, savedState.uploadId);
      uploadId = savedState.uploadId;
      key = savedState.key;
      completedParts = serverParts.parts.map((p: { PartNumber: number; ETag: string }) => ({
        PartNumber: p.PartNumber,
        ETag: p.ETag,
      }));
      for (const p of completedParts) skipPartNumbers.add(p.PartNumber);

      // Report resumed progress
      onProgress?.({
        loaded: serverParts.totalUploaded,
        total: blob.size,
        percent: Math.round((serverParts.totalUploaded / blob.size) * 100),
        partNumber: 0,
      });
    } catch {
      // Saved state is stale (upload expired or aborted); start fresh
      await clearUploadState(stateKey);
    }
  }

  // ── Initiate new multipart upload if needed ─────────────────────
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

  // ── Upload Part 1 (special: also goes to temp for WAV header patching) ──
  if (!skipPartNumbers.has(1)) {
    const part1Blob = blob.slice(0, PART_SIZE);

    // Get temp presigned URL for Part 1
    const part1Res = await fetch(`${API_BASE}/multipart-upload/part-1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: uploadId! }),
    });
    const { url: part1Url } = await part1Res.json();

    // Upload Part 1 to temp location (for WAV header extraction later)
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

    // Persist progress after Part 1
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

  // ── Upload remaining parts concurrently (3 at a time) ─────────────
  const partTasks: Array<() => Promise<{ PartNumber: number; ETag: string }>> = [];

  for (let partNumber = 2; partNumber <= totalParts; partNumber++) {
    if (skipPartNumbers.has(partNumber)) continue;

    const pn = partNumber; // Capture for closure
    partTasks.push(async () => {
      const start = (pn - 1) * PART_SIZE;
      const end = Math.min(start + PART_SIZE, blob.size);
      const partBlob = blob.slice(start, end);

      // Get presigned URL for this part
      const partRes = await fetch(`${API_BASE}/multipart-upload/part-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key!, uploadId: uploadId!, partNumber: pn }),
      });
      const { url: partUrl } = await partRes.json();

      // Upload part directly to S3
      const etag = await uploadPartAndGetEtag(partUrl, partBlob);

      // Report progress
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

  // Merge results and persist final state
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

  // Sort parts by number — S3 requires ordered completion
  completedParts.sort((a, b) => a.PartNumber - b.PartNumber);

  // ── Complete the multipart upload ─────────────────────────────────
  // Server patches WAV header, assembles parts, creates Recording entry
  await fetch(`${API_BASE}/multipart-upload/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: key!, uploadId: uploadId!, parts: completedParts, roomId, participantName, sessionId }),
  });

  // Clear saved state on success
  await clearUploadState(stateKey);
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Fetch the list of already-uploaded parts from the server.
 * Used for resume: compare server state with local state.
 */
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

/**
 * Run async tasks with bounded concurrency.
 * Spawns N workers that each pull from the task queue until empty.
 *
 * @param tasks — Array of async factory functions
 * @param concurrency — Max simultaneous tasks
 * @returns Results in the same order as input tasks
 */
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

/**
 * Upload a blob to a presigned URL and report progress.
 * Used for simple uploads and Part 1 temp upload.
 */
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

/**
 * Upload a part to a presigned URL and extract the ETag from the response.
 * The ETag is required for the S3 CompleteMultipartUpload call.
 */
async function uploadPartAndGetEtag(url: string, blob: Blob): Promise<string> {
  const response = await fetch(url, {
    method: 'PUT',
    body: blob,
  });
  return response.headers.get('ETag') || '';
}
