/**
 * storageService.ts — IndexedDB persistence for recording recovery and upload resume.
 *
 * Provides two object stores for crash-resilient data persistence:
 *
 * ## 1. recording-chunks Store
 *
 * Stores raw Float32Array audio chunks during an active recording. If the
 * browser crashes or the tab is closed, these chunks can be re-read and
 * encoded into a WAV file on the next session.
 *
 * Schema:
 *   - id (auto-increment primary key)
 *   - sessionKey: string — "roomId:userId:sessionId" identifier
 *   - chunkIndex: number — ordering within the recording
 *   - data: ArrayBuffer — the raw audio samples (copied from Float32Array)
 *   - timestamp: number — when the chunk was stored
 *
 * Index: sessionKey (for querying all chunks of a recording)
 *
 * ## 2. upload-state Store
 *
 * Stores multipart upload progress for resumable uploads. If a large file
 * upload is interrupted, the saved state (uploadId, completed parts) allows
 * the upload to resume from where it left off.
 *
 * Schema:
 *   - sessionKey (primary key) — "upload:roomId:participantName:sessionId"
 *   - uploadId: string — S3 multipart upload ID
 *   - key: string — S3 object key
 *   - roomId, participantName, sessionId — upload metadata
 *   - totalParts: number — total number of parts expected
 *   - completedParts: Array<{PartNumber, ETag}> — already uploaded parts
 *   - blobSize: number — total file size (for validation on resume)
 *   - createdAt: number — timestamp
 *
 * ## Database
 *
 * - Name: 'audio-studio'
 * - Version: 1
 * - Lazy initialization via singleton Promise (opened once, reused)
 *
 * ## Usage
 *
 * Recording chunks:
 *   storeChunk() — called by recorderService on each AudioWorklet buffer
 *   getChunks() — called during recovery to rebuild the WAV
 *   clearChunks() — called after successful encoding or user dismiss
 *   getPendingRecordings() — called on Studio mount to detect recoverable sessions
 *
 * Upload state:
 *   saveUploadState() — called by uploadService after each part completes
 *   getUploadState() — called at upload start to check for resumable state
 *   clearUploadState() — called after successful upload completion
 */

const DB_NAME = 'audio-studio';
const DB_VERSION = 1;
const CHUNKS_STORE = 'recording-chunks';
const UPLOAD_STATE_STORE = 'upload-state';

interface RecordingChunkRecord {
  id?: number;            // Auto-increment primary key
  sessionKey: string;     // Recording identifier
  chunkIndex: number;     // Ordering within the recording
  data: ArrayBuffer;      // Raw Float32Array samples (detached from original)
  timestamp: number;      // When stored
}

export interface PendingRecording {
  sessionKey: string;     // Recording identifier
  chunkCount: number;     // Number of chunks stored
  sampleRate: number;     // Always 48000
  startedAt: number;      // Timestamp of first chunk
}

export interface UploadStateRecord {
  sessionKey: string;     // Primary key
  uploadId: string;       // S3 multipart upload ID
  key: string;            // S3 object key
  roomId: string;
  participantName: string;
  sessionId: string;
  totalParts: number;     // Expected total parts
  completedParts: Array<{ PartNumber: number; ETag: string }>; // Already uploaded
  blobSize: number;       // Total file size (for validation)
  createdAt: number;      // When upload started
}

/** Singleton Promise — database opened once and reused for all operations */
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open (or return cached) the IndexedDB database.
 * Creates object stores on first open (version 1 upgrade).
 */
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Recording chunks store — auto-increment ID, indexed by sessionKey
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const store = db.createObjectStore(CHUNKS_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('sessionKey', 'sessionKey', { unique: false });
      }

      // Upload state store — keyed by sessionKey
      if (!db.objectStoreNames.contains(UPLOAD_STATE_STORE)) {
        db.createObjectStore(UPLOAD_STATE_STORE, { keyPath: 'sessionKey' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

// ─── Chunk Operations ────────────────────────────────────────────

/**
 * Store a single audio chunk in IndexedDB.
 * Called by recorderService in fire-and-forget mode (non-blocking).
 *
 * @param sessionKey — Recording identifier (roomId:userId:sessionId)
 * @param chunkIndex — Sequential index for ordering
 * @param data — Float32Array of audio samples (ArrayBuffer is copied via .slice(0))
 */
export async function storeChunk(
  sessionKey: string,
  chunkIndex: number,
  data: Float32Array,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, 'readwrite');
    tx.objectStore(CHUNKS_STORE).add({
      sessionKey,
      chunkIndex,
      data: data.buffer.slice(0), // Detach from original buffer to prevent issues
      timestamp: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieve all chunks for a recording, sorted by chunkIndex.
 * Used during recovery to rebuild the WAV file.
 */
export async function getChunks(sessionKey: string): Promise<Float32Array[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, 'readonly');
    const index = tx.objectStore(CHUNKS_STORE).index('sessionKey');
    const request = index.getAll(sessionKey);
    request.onsuccess = () => {
      const records = request.result as RecordingChunkRecord[];
      records.sort((a, b) => a.chunkIndex - b.chunkIndex);
      resolve(records.map((r) => new Float32Array(r.data)));
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete all chunks for a recording.
 * Called after successful WAV encoding or when user dismisses recovery.
 */
export async function clearChunks(sessionKey: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, 'readwrite');
    const store = tx.objectStore(CHUNKS_STORE);
    const index = store.index('sessionKey');
    const request = index.openCursor(sessionKey);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue(); // Delete each matching record
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Scan IndexedDB for any orphaned recording chunks (from crashed sessions).
 * Groups chunks by sessionKey and returns metadata for the recovery banner.
 */
export async function getPendingRecordings(): Promise<PendingRecording[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, 'readonly');
    const request = tx.objectStore(CHUNKS_STORE).getAll();
    request.onsuccess = () => {
      const records = request.result as RecordingChunkRecord[];

      // Group chunks by sessionKey
      const grouped = new Map<string, RecordingChunkRecord[]>();
      for (const r of records) {
        if (!grouped.has(r.sessionKey)) grouped.set(r.sessionKey, []);
        grouped.get(r.sessionKey)!.push(r);
      }

      // Convert to PendingRecording metadata
      const pending: PendingRecording[] = [];
      for (const [sessionKey, chunks] of grouped) {
        pending.push({
          sessionKey,
          chunkCount: chunks.length,
          sampleRate: 48000,
          startedAt: chunks[0]?.timestamp ?? 0,
        });
      }
      resolve(pending);
    };
    request.onerror = () => reject(request.error);
  });
}

// ─── Upload State Operations ─────────────────────────────────────

/**
 * Save multipart upload progress for resume support.
 * Uses `put()` (upsert) so it can be called repeatedly as parts complete.
 */
export async function saveUploadState(state: UploadStateRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOAD_STATE_STORE, 'readwrite');
    tx.objectStore(UPLOAD_STATE_STORE).put(state);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieve saved upload state for a session key.
 * Returns null if no saved state exists (first upload or already completed).
 */
export async function getUploadState(sessionKey: string): Promise<UploadStateRecord | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOAD_STATE_STORE, 'readonly');
    const request = tx.objectStore(UPLOAD_STATE_STORE).get(sessionKey);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear saved upload state after successful completion.
 */
export async function clearUploadState(sessionKey: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOAD_STATE_STORE, 'readwrite');
    tx.objectStore(UPLOAD_STATE_STORE).delete(sessionKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
