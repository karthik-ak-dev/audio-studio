import { useState, useCallback } from 'react';
import type { Meeting } from '../shared';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface UseMeetingReturn {
  meeting: Meeting | null;
  isLoading: boolean;
  error: string | null;
  createMeeting: (title: string) => Promise<Meeting>;
  fetchMeeting: (meetingId: string) => Promise<Meeting>;
}

export function useMeeting(): UseMeetingReturn {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createMeeting = useCallback(async (title: string): Promise<Meeting> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('Failed to create meeting');
      const data = await res.json();
      setMeeting(data);
      return data;
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchMeeting = useCallback(async (meetingId: string): Promise<Meeting> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/meetings/${meetingId}`);
      if (!res.ok) throw new Error('Meeting not found');
      const data = await res.json();
      setMeeting(data);
      return data;
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { meeting, isLoading, error, createMeeting, fetchMeeting };
}
