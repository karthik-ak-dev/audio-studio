import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_DURATION_SEC } from "@/config/constants";

interface PauseEvent {
  paused_at: string;
  resumed_at: string | null;
}

interface UseRecordingTimerReturn {
  elapsedSeconds: number;
  formatted: string;
  progress: number;
  isRunning: boolean;
  /**
   * Compute elapsed recording time from server timestamps.
   * Subtracts all paused durations from wall-clock time.
   * Works correctly on refresh, resume, and for both participants.
   */
  sync: (
    startedAt: string,
    pauseEvents: PauseEvent[],
    isCurrentlyRecording: boolean,
  ) => void;
  reset: () => void;
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

/**
 * Calculate actual recording seconds = wall-clock minus total paused time.
 *
 * If currently recording: elapsed = (now - startedAt) - totalPausedMs
 * If currently paused:    elapsed = (lastPauseAt - startedAt) - totalPausedMsBefore
 *   i.e. freeze at the moment the current pause began.
 */
function computeElapsed(
  startedAt: string,
  pauseEvents: PauseEvent[],
): number {
  const startMs = new Date(startedAt).getTime();
  const nowMs = Date.now();

  let totalPausedMs = 0;

  for (const pe of pauseEvents) {
    const pausedMs = new Date(pe.paused_at).getTime();

    if (pe.resumed_at) {
      // Completed pause — full duration
      totalPausedMs += new Date(pe.resumed_at).getTime() - pausedMs;
    } else {
      // Open pause (currently paused) — freeze timer at pause start
      // The "active" portion ends at pause start, not now
      totalPausedMs += nowMs - pausedMs;
    }
  }

  const elapsedMs = nowMs - startMs - totalPausedMs;
  return Math.max(0, Math.floor(elapsedMs / 1000));
}

export function useRecordingTimer(): UseRecordingTimerReturn {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Store latest args so the interval tick can recompute from server data
  const syncArgsRef = useRef<{
    startedAt: string;
    pauseEvents: PauseEvent[];
    isCurrentlyRecording: boolean;
  } | null>(null);

  const reset = useCallback(() => {
    setIsRunning(false);
    setElapsedSeconds(0);
    syncArgsRef.current = null;
  }, []);

  const sync = useCallback(
    (startedAt: string, pauseEvents: PauseEvent[], isCurrentlyRecording: boolean) => {
      syncArgsRef.current = { startedAt, pauseEvents, isCurrentlyRecording };
      const elapsed = computeElapsed(startedAt, pauseEvents);
      setElapsedSeconds(elapsed);
      setIsRunning(isCurrentlyRecording);
    },
    [],
  );

  // Tick: recompute from server timestamps each second while recording
  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        if (syncArgsRef.current) {
          const { startedAt, pauseEvents } = syncArgsRef.current;
          const elapsed = computeElapsed(startedAt, pauseEvents);
          setElapsedSeconds(elapsed);
        }
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
    sync,
    reset,
  };
}
