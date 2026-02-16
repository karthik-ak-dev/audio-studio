/**
 * useRecorder.ts — React hook wrapping the recorderService for local audio capture.
 *
 * Provides a clean React interface for starting/stopping audio recording
 * and recovering crashed recordings from IndexedDB.
 *
 * ## Recording Pipeline
 *
 * The actual recording happens in recorderService.ts:
 *   MediaStream → AudioContext (48kHz) → AudioWorklet → Float32Array chunks
 *   Chunks are stored in memory AND persisted to IndexedDB for crash recovery.
 *   On stop, chunks are encoded into a WAV blob (48kHz 16-bit PCM).
 *
 * ## State Tracking
 *
 * - `isRecording` — Whether recording is currently active
 * - `recordingDuration` — Elapsed seconds (updated every 1s via setInterval)
 *
 * ## Session Key
 *
 * Each recording is identified by a session key: `roomId:userId:sessionId`
 * This key is used for IndexedDB persistence, enabling recovery if the
 * browser crashes mid-recording.
 *
 * ## Recovery Flow
 *
 * 1. On Studio mount, getPendingRecordings() checks IndexedDB for orphaned chunks
 * 2. User clicks "Recover & Upload" → recover(sessionKey) is called
 * 3. recoverRecording() reads chunks from IndexedDB, encodes to WAV blob
 * 4. Blob is then uploaded via the normal upload pipeline
 */

import { useState, useCallback, useRef } from 'react';
import {
  startRecording as startRec,
  stopRecording as stopRec,
  recoverRecording,
} from '@/services/recorderService';

export interface UseRecorderReturn {
  isRecording: boolean;
  recordingDuration: number;
  start: (stream: MediaStream, sessionKey?: string) => Promise<void>;
  stop: () => Blob | null;
  recover: (sessionKey: string) => Promise<Blob | null>;
}

export function useRecorder(): UseRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);

  /** Timer ref for the 1-second duration counter */
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Timestamp when recording started (for duration calculation) */
  const startTimeRef = useRef<number>(0);

  /**
   * Start recording from the given MediaStream.
   * Delegates to recorderService which sets up AudioWorklet or ScriptProcessor.
   * Starts a 1-second interval timer for the duration display.
   */
  const start = useCallback(async (stream: MediaStream, sessionKey?: string) => {
    await startRec(stream, sessionKey);
    setIsRecording(true);
    startTimeRef.current = Date.now();

    timerRef.current = setInterval(() => {
      setRecordingDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, []);

  /**
   * Stop recording and return the encoded WAV blob.
   * Clears the duration timer and resets state.
   * Returns null if no chunks were captured.
   */
  const stop = useCallback((): Blob | null => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setIsRecording(false);
    const blob = stopRec();
    setRecordingDuration(0);
    return blob;
  }, []);

  /**
   * Recover a recording from IndexedDB after a crash.
   * Reads stored Float32Array chunks, encodes to WAV, clears IndexedDB.
   */
  const recover = useCallback(async (sessionKey: string): Promise<Blob | null> => {
    return recoverRecording(sessionKey);
  }, []);

  return { isRecording, recordingDuration, start, stop, recover };
}
