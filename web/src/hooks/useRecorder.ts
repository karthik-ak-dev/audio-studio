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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const start = useCallback(async (stream: MediaStream, sessionKey?: string) => {
    await startRec(stream, sessionKey);
    setIsRecording(true);
    startTimeRef.current = Date.now();

    timerRef.current = setInterval(() => {
      setRecordingDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, []);

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

  const recover = useCallback(async (sessionKey: string): Promise<Blob | null> => {
    return recoverRecording(sessionKey);
  }, []);

  return { isRecording, recordingDuration, start, stop, recover };
}
