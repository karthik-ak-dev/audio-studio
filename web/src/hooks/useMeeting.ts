/**
 * useMeeting.ts — REST API hook for meeting management.
 *
 * Provides methods to create and fetch meetings, and assign participants
 * via the server's HTTP API. Used by the Home page for session creation/joining.
 *
 * ## API Endpoints
 *
 * - `createMeeting(title, hostName, hostEmail)` → POST /api/meetings
 *   Body: { title, hostName, hostEmail }
 *   Response: Meeting object with meetingId (UUID), status: 'scheduled'
 *   Auth: Required in prod (JWT Bearer token), bypassed in dev
 *
 * - `fetchMeeting(meetingId)` → GET /api/meetings/:id
 *   Response: Meeting object
 *   Auth: Public (no auth required — guests need to view meeting details)
 *
 * - `assignGuest(meetingId, name, email)` → POST /api/meetings/:id/assign-guest
 *   Body: { name, email }
 *   Response: { assigned: boolean }
 *   Auth: Public (self-serve guest assignment)
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
  createMeeting: (title: string, hostName: string, hostEmail: string) => Promise<Meeting>;
  fetchMeeting: (meetingId: string) => Promise<Meeting>;
  assignGuest: (meetingId: string, name: string, email: string) => Promise<boolean>;
}

export function useMeeting(): UseMeetingReturn {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Create a new meeting via POST /api/meetings.
   * Sends host identity (name + email) along with the title.
   */
  const createMeeting = useCallback(async (title: string, hostName: string, hostEmail: string): Promise<Meeting> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, hostName, hostEmail }),
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

  /**
   * Assign guest identity to a meeting via POST /api/meetings/:id/assign-guest.
   * Called when a guest joins an existing session. Uses a DynamoDB conditional
   * write for race safety — only the first guest to claim the slot wins.
   */
  const assignGuest = useCallback(async (meetingId: string, name: string, email: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/meetings/${meetingId}/assign-guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Failed to join meeting');
      }
      const data = await res.json();
      return data.assigned;
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { meeting, isLoading, error, createMeeting, fetchMeeting, assignGuest };
}
