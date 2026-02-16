const DB_NAME = 'audio-studio';
const DB_VERSION = 1;
const CHUNKS_STORE = 'recording-chunks';
const UPLOAD_STATE_STORE = 'upload-state';

interface RecordingChunkRecord {
  id?: number;
  sessionKey: string;
  chunkIndex: number;
  data: ArrayBuffer;
  timestamp: number;
}

export interface PendingRecording {
  sessionKey: string;
  chunkCount: number;
  sampleRate: number;
  startedAt: number;
}

export interface UploadStateRecord {
  sessionKey: string;
  uploadId: string;
  key: string;
  roomId: string;
  participantName: string;
  sessionId: string;
  totalParts: number;
  completedParts: Array<{ PartNumber: number; ETag: string }>;
  blobSize: number;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const store = db.createObjectStore(CHUNKS_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('sessionKey', 'sessionKey', { unique: false });
      }

      if (!db.objectStoreNames.contains(UPLOAD_STATE_STORE)) {
        db.createObjectStore(UPLOAD_STATE_STORE, { keyPath: 'sessionKey' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

// ─── Chunk operations ────────────────────────────────────────────

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
      data: data.buffer.slice(0),
      timestamp: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

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
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingRecordings(): Promise<PendingRecording[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, 'readonly');
    const request = tx.objectStore(CHUNKS_STORE).getAll();
    request.onsuccess = () => {
      const records = request.result as RecordingChunkRecord[];
      const grouped = new Map<string, RecordingChunkRecord[]>();
      for (const r of records) {
        if (!grouped.has(r.sessionKey)) grouped.set(r.sessionKey, []);
        grouped.get(r.sessionKey)!.push(r);
      }
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

// ─── Upload state operations ─────────────────────────────────────

export async function saveUploadState(state: UploadStateRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOAD_STATE_STORE, 'readwrite');
    tx.objectStore(UPLOAD_STATE_STORE).put(state);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getUploadState(sessionKey: string): Promise<UploadStateRecord | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOAD_STATE_STORE, 'readonly');
    const request = tx.objectStore(UPLOAD_STATE_STORE).get(sessionKey);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function clearUploadState(sessionKey: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOAD_STATE_STORE, 'readwrite');
    tx.objectStore(UPLOAD_STATE_STORE).delete(sessionKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
