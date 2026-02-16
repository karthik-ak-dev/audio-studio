/**
 * useMeeting.ts — REST API hook for meeting management.
 *
 * Provides methods to create and fetch meetings via the server's HTTP API.
 * Used by the Home page for session creation and could be used by any page
 * that needs meeting metadata.
 *
 * ## API Endpoints
 *
 * - `createMeeting(title)` → POST /api/meetings
 *   Body: { title }
 *   Response: Meeting object with meetingId (UUID), status: 'scheduled'
 *   Auth: Required in prod (JWT Bearer token), bypassed in dev
 *
 * - `fetchMeeting(meetingId)` → GET /api/meetings/:id
 *   Response: Meeting object
 *   Auth: Public (no auth required — guests need to view meeting details)
 *
 * ## State Management
 *
 * - `meeting` — Last fetched/created Meeting object
 * - `isLoading` — True during API calls (used for button disabled states)
 * - `error` — Error message from the last failed API call (cleared on next call)
 *
 * ## Error Handling
 *
 * Errors are caught, stored in state for display, and re-thrown so the
 * caller can also handle them (e.g., to prevent navigation on failure).
 */

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

  /**
   * Create a new meeting via POST /api/meetings.
   * The server generates a UUID meetingId, sets status to 'scheduled',
   * and persists to DynamoDB AudioStudio_Meetings table.
   */
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

  /**
   * Fetch an existing meeting via GET /api/meetings/:id.
   * This is a public endpoint — no auth required.
   */
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
