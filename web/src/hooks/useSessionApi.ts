import { useCallback, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import type { CreateSessionRequest, CreateSessionResponse, Session } from "@/types/session";

interface UseSessionApiReturn {
  loading: boolean;
  error: string | null;
  createSession: (data: CreateSessionRequest) => Promise<CreateSessionResponse | null>;
  getSession: (sessionId: string) => Promise<Session | null>;
  stopSession: (sessionId: string) => Promise<boolean>;
  pauseSession: (sessionId: string) => Promise<boolean>;
  resumeSession: (sessionId: string) => Promise<boolean>;
  clearError: () => void;
}

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
        const result = await api.createSession(data);
        return result;
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

  const stopSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      setLoading(true);
      setError(null);
      try {
        await api.stopSession(sessionId);
        return true;
      } catch (err) {
        handleError(err);
        return false;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [handleError],
  );

  const pauseSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      setLoading(true);
      setError(null);
      try {
        await api.pauseSession(sessionId);
        return true;
      } catch (err) {
        handleError(err);
        return false;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [handleError],
  );

  const resumeSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      setLoading(true);
      setError(null);
      try {
        await api.resumeSession(sessionId);
        return true;
      } catch (err) {
        handleError(err);
        return false;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [handleError],
  );

  return {
    loading,
    error,
    createSession,
    getSession,
    stopSession,
    pauseSession,
    resumeSession,
    clearError,
  };
}
