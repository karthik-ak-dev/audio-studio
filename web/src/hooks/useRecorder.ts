import { useState, useCallback, useRef } from 'react';
import { startRecording as startRec, stopRecording as stopRec } from '@/services/recorderService';

export interface UseRecorderReturn {
  isRecording: boolean;
  recordingDuration: number;
  start: (stream: MediaStream) => Promise<void>;
  stop: () => Blob | null;
}

export function useRecorder(): UseRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const start = useCallback(async (stream: MediaStream) => {
    await startRec(stream);
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

  return { isRecording, recordingDuration, start, stop };
}
