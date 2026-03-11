import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_DURATION_SEC } from "@/config/constants";

interface UseRecordingTimerReturn {
  elapsedSeconds: number;
  formatted: string;
  progress: number;
  isRunning: boolean;
  start: () => void;
  stop: () => void;
  reset: () => void;
  /** Sync elapsed time from a server-provided ISO timestamp */
  syncWithServer: (startedAt: string) => void;
}

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number): string => n.toString().padStart(2, "0");

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function useRecordingTimer(): UseRecordingTimerReturn {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(() => {
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    setIsRunning(false);
    setElapsedSeconds(0);
  }, []);

  /** Derive elapsed from server timestamp — survives refresh */
  const syncWithServer = useCallback((startedAt: string) => {
    const startTime = new Date(startedAt).getTime();
    const now = Date.now();
    const elapsed = Math.max(0, Math.floor((now - startTime) / 1000));
    setElapsedSeconds(elapsed);
  }, []);

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning]);

  return {
    elapsedSeconds,
    formatted: formatTime(elapsedSeconds),
    progress: elapsedSeconds / MAX_RECORDING_DURATION_SEC,
    isRunning,
    start,
    stop,
    reset,
    syncWithServer,
  };
}
