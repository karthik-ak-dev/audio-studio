/**
 * Home.tsx — Landing page for Audio Studio.
 *
 * This is the entry point of the user journey. It provides two actions:
 *
 * 1. **Create Session** — Calls POST /api/meetings with an optional title.
 *    On success, navigates the user to the GreenRoom for mic testing.
 *    The server returns a Meeting object with a UUID meetingId.
 *
 * 2. **Join Session** — Takes a meetingId (or link) and navigates directly
 *    to the GreenRoom. No API call is made here — the meeting is validated
 *    when the user connects via Socket.IO in the GreenRoom/Studio.
 *
 * Backend endpoints used:
 *   POST /api/meetings  →  Creates a new meeting (requires auth in prod,
 *                           bypassed in dev when JWT_SECRET is not set)
 *
 * Flow after this page:
 *   Home → /room/:roomId/green-room → /room/:roomId (Studio) → /room/:roomId/results
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMeeting } from '@/hooks/useMeeting';

export default function Home() {
  const navigate = useNavigate();
  const { createMeeting, isLoading, error } = useMeeting();

  /** Title for new session — optional, defaults to 'Untitled Session' */
  const [title, setTitle] = useState('');

  /** Meeting ID input for joining an existing session */
  const [joinId, setJoinId] = useState('');

  /**
   * Create a new meeting via the REST API and navigate to its green room.
   * The useMeeting hook handles loading state and error display.
   */
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const meeting = await createMeeting(title || 'Untitled Session');
    navigate(`/room/${meeting.meetingId}/green-room`);
  };

  /**
   * Navigate to the green room for an existing meeting.
   * We don't validate the meetingId here — the server will reject
   * invalid rooms when the user tries to join via Socket.IO.
   */
  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinId.trim()) {
      navigate(`/room/${joinId.trim()}/green-room`);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="mb-2 text-4xl font-bold text-white">Audio Studio</h1>
          <p className="text-gray-400">High-quality audio recording for dataset collection</p>
        </div>

        {/* Global error banner — shown when meeting creation fails */}
        {error && (
          <div className="px-4 py-3 text-sm text-red-200 border border-red-500 rounded-lg bg-red-900/50">
            {error}
          </div>
        )}

        {/* ── Create new session ─────────────────────────────────── */}
        <form onSubmit={handleCreate} className="p-6 space-y-4 bg-gray-900 border border-gray-800 rounded-xl">
          <h2 className="text-lg font-semibold text-white">Create New Session</h2>
          <input
            type="text"
            placeholder="Session title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-studio-500"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-studio-600 hover:bg-studio-700 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Creating...' : 'Create Session'}
          </button>
        </form>

        {/* ── Join existing session ──────────────────────────────── */}
        <form onSubmit={handleJoin} className="p-6 space-y-4 bg-gray-900 border border-gray-800 rounded-xl">
          <h2 className="text-lg font-semibold text-white">Join Session</h2>
          <input
            type="text"
            placeholder="Enter meeting ID or paste link"
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-studio-500"
          />
          <button
            type="submit"
            disabled={!joinId.trim()}
            className="w-full bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            Join Session
          </button>
        </form>
      </div>
    </div>
  );
}
