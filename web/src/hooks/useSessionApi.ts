import { useCallback, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import type { JoinSessionBody, LeaveSessionBody } from "@/api/client";
import type { CreateSessionRequest, CreateSessionResponse, Session } from "@/types/session";

/** Return type for action calls: true=success, false=real error, "stale"=400 (re-poll needed) */
export type ActionResult = true | false | "stale";

interface UseSessionApiReturn {
  loading: boolean;
  error: string | null;
  createSession: (data: CreateSessionRequest) => Promise<CreateSessionResponse | null>;
  getSession: (sessionId: string) => Promise<Session | null>;
  /** Silent poll — no loading flag, no error state. Returns null on failure. */
  pollSession: (sessionId: string) => Promise<Session | null>;
  joinSession: (sessionId: string, body: JoinSessionBody) => Promise<boolean>;
  leaveSession: (sessionId: string, body: LeaveSessionBody) => Promise<boolean>;
  startRecording: (sessionId: string) => Promise<ActionResult>;
  endSession: (sessionId: string) => Promise<ActionResult>;
  pauseSession: (sessionId: string) => Promise<ActionResult>;
  resumeSession: (sessionId: string) => Promise<ActionResult>;
  cancelSession: (sessionId: string, hostUserId: string, reason: string) => Promise<ActionResult>;
  clearError: () => void;
}

const JOIN_RETRY_DELAY_MS = 2000;

export function useSessionApi(): UseSessionApiReturn {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef<boolean>(true);

  const clearError = useCallback(() => setError(null), []);

  const handleError = useCallback((err: unknown): null => {
    if (!mountedRef.current) return null;
    const message =
      err instanceof ApiError
        ? err.detail
        : err instanceof Error
          ? err.message
          : "An unexpected error occurred";
    setError(message);
    return null;
  }, []);

  const createSession = useCallback(
    async (data: CreateSessionRequest): Promise<CreateSessionResponse | null> => {
      setLoading(true);
      setError(null);
      try {
        return await api.createSession(data);
      } catch (err) {
        return handleError(err);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [handleError],
  );

  const getSession = useCallback(
    async (sessionId: string): Promise<Session | null> => {
      setLoading(true);
      setError(null);
      try {
        return await api.getSession(sessionId);
      } catch (err) {
        return handleError(err);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [handleError],
  );

  // Silent poll — no loading flag, no error state
  const pollSession = useCallback(
    async (sessionId: string): Promise<Session | null> => {
      try {
        return await api.getSession(sessionId);
      } catch {
        return null;
      }
    },
    [],
  );

  // Blocking join with retry-once-after-2s
  const joinSession = useCallback(
    async (sessionId: string, body: JoinSessionBody): Promise<boolean> => {
      try {
        await api.joinSession(sessionId, body);
        return true;
      } catch (err) {
        console.warn("Join attempt 1 failed, retrying in 2s:", err);
        // Retry once after delay
        await new Promise((r) => setTimeout(r, JOIN_RETRY_DELAY_MS));
        try {
          await api.joinSession(sessionId, body);
          return true;
        } catch (retryErr) {
          console.warn("Join attempt 2 failed:", retryErr);
          return false;
        }
      }
    },
    [],
  );

  const leaveSession = useCallback(
    async (sessionId: string, body: LeaveSessionBody): Promise<boolean> => {
      try {
        await api.leaveSession(sessionId, body);
        return true;
      } catch (err) {
        console.warn("Failed to notify server of leave:", err);
        return false;
      }
    },
    [],
  );

  // Action helper: returns "stale" on 400 (server state diverged), false on real error
  const executeAction = useCallback(
    async (action: () => Promise<unknown>): Promise<ActionResult> => {
      setLoading(true);
      setError(null);
      try {
        await action();
        return true;
      } catch (err) {
        // 400 = state mismatch → caller should re-poll silently, no error shown
        if (err instanceof ApiError && err.status === 400) {
          return "stale";
        }
        handleError(err);
        return false;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [handleError],
  );

  const startRecording = useCallback(
    (sessionId: string) => executeAction(() => api.startRecording(sessionId)),
    [executeAction],
  );

  const endSession = useCallback(
    (sessionId: string) => executeAction(() => api.endSession(sessionId)),
    [executeAction],
  );

  const pauseSession = useCallback(
    (sessionId: string) => executeAction(() => api.pauseSession(sessionId)),
    [executeAction],
  );

  const resumeSession = useCallback(
    (sessionId: string) => executeAction(() => api.resumeSession(sessionId)),
    [executeAction],
  );

  const cancelSession = useCallback(
    (sessionId: string, hostUserId: string, reason: string) =>
      executeAction(() => api.cancelSession(sessionId, { host_user_id: hostUserId, reason })),
    [executeAction],
  );

  return {
    loading,
    error,
    createSession,
    getSession,
    pollSession,
    joinSession,
    leaveSession,
    startRecording,
    endSession,
    pauseSession,
    resumeSession,
    cancelSession,
    clearError,
  };
}
