/**
 * Home.tsx — Landing page for Audio Studio.
 *
 * Provides a tabbed interface with two modes:
 *
 * 1. **Create Session** — Collects host name, email, and optional title.
 *    Calls POST /api/meetings with host identity. On success, stores user
 *    info in localStorage and navigates to the GreenRoom for mic testing.
 *
 * 2. **Join Session** — Collects guest name, email, and meeting ID.
 *    Calls POST /api/meetings/:id/assign-guest to claim the guest slot,
 *    then navigates to the GreenRoom.
 *
 * User identity (name, email) is persisted in localStorage so it survives
 * navigation to GreenRoom → Studio and can be passed to the socket join-room.
 *
 * Backend endpoints used:
 *   POST /api/meetings                    → Create meeting with host identity
 *   POST /api/meetings/:id/assign-guest   → Assign guest name + email
 *
 * Flow after this page:
 *   Home → /room/:roomId/green-room → /room/:roomId (Studio) → /room/:roomId/results
 */

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMeeting } from '@/hooks/useMeeting';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = 'create' | 'join';

export default function Home() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { createMeeting, assignGuest, isLoading, error } = useMeeting();

  // If ?room=<id> is present (from invite link redirect), start in Join mode
  const roomFromUrl = searchParams.get('room') || '';

  const [mode, setMode] = useState<Mode>(roomFromUrl ? 'join' : 'create');

  // Shared fields — always start empty, user must enter each time
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  // Create-specific
  const [title, setTitle] = useState('');

  // Join-specific — pre-filled from ?room= query param if present
  const [joinId, setJoinId] = useState(roomFromUrl);

  // Validation
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /** Validate form fields. Returns true if valid. */
  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!name.trim()) {
      errors.name = 'Name is required';
    }
    if (!email.trim()) {
      errors.email = 'Email is required';
    } else if (!EMAIL_REGEX.test(email.trim())) {
      errors.email = 'Please enter a valid email';
    }
    if (mode === 'join' && !joinId.trim()) {
      errors.joinId = 'Meeting ID is required';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /** Persist user identity in localStorage for downstream pages */
  const persistIdentity = () => {
    localStorage.setItem('userName', name.trim());
    localStorage.setItem('userEmail', email.trim());
  };

  /**
   * Create a new meeting with host identity and navigate to green room.
   */
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const meeting = await createMeeting(
      title.trim() || 'Untitled Session',
      name.trim(),
      email.trim(),
    );
    persistIdentity();
    navigate(`/room/${meeting.meetingId}/green-room`);
  };

  /**
   * Assign guest to existing meeting and navigate to green room.
   */
  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const meetingId = joinId.trim();
    await assignGuest(meetingId, name.trim(), email.trim());
    persistIdentity();
    navigate(`/room/${meetingId}/green-room`);
  };

  /** Switch between Create and Join modes */
  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    setFieldErrors({});
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="mb-2 text-4xl font-bold text-surface-50">Audio Studio</h1>
          <p className="text-surface-400">High-quality audio recording for dataset collection</p>
        </div>

        {/* Main card */}
        <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
          {/* Tab toggle */}
          <div className="flex border-b border-surface-700">
            <button
              type="button"
              onClick={() => switchMode('create')}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                mode === 'create'
                  ? 'text-accent-400 border-b-2 border-accent-400 bg-surface-900'
                  : 'text-surface-400 hover:text-surface-200 bg-surface-900/50'
              }`}
            >
              Create Session
            </button>
            <button
              type="button"
              onClick={() => switchMode('join')}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                mode === 'join'
                  ? 'text-accent-400 border-b-2 border-accent-400 bg-surface-900'
                  : 'text-surface-400 hover:text-surface-200 bg-surface-900/50'
              }`}
            >
              Join Session
            </button>
          </div>

          {/* Form */}
          <form onSubmit={mode === 'create' ? handleCreate : handleJoin} className="p-6 space-y-4">
            {/* Global error banner */}
            {error && (
              <div className="px-4 py-3 text-sm text-danger-light border border-danger rounded-lg bg-danger-dark/50">
                {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label htmlFor="name" className="block mb-1.5 text-sm font-medium text-surface-300">
                Your Name
              </label>
              <input
                id="name"
                type="text"
                placeholder="Enter your name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, name: '' }));
                }}
                className={`w-full bg-surface-800 border rounded-lg px-4 py-2.5 text-surface-50 placeholder-surface-500 focus:outline-none focus:border-accent-400 ${
                  fieldErrors.name ? 'border-danger' : 'border-surface-600'
                }`}
              />
              {fieldErrors.name && (
                <p className="mt-1 text-xs text-danger-light">{fieldErrors.name}</p>
              )}
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block mb-1.5 text-sm font-medium text-surface-300">
                Your Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, email: '' }));
                }}
                className={`w-full bg-surface-800 border rounded-lg px-4 py-2.5 text-surface-50 placeholder-surface-500 focus:outline-none focus:border-accent-400 ${
                  fieldErrors.email ? 'border-danger' : 'border-surface-600'
                }`}
              />
              {fieldErrors.email && (
                <p className="mt-1 text-xs text-danger-light">{fieldErrors.email}</p>
              )}
            </div>

            {/* Mode-specific field */}
            {mode === 'create' ? (
              <div>
                <label htmlFor="title" className="block mb-1.5 text-sm font-medium text-surface-300">
                  Session Title <span className="text-surface-500">(optional)</span>
                </label>
                <input
                  id="title"
                  type="text"
                  placeholder="e.g. Interview with Alex"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-surface-800 border border-surface-600 rounded-lg px-4 py-2.5 text-surface-50 placeholder-surface-500 focus:outline-none focus:border-accent-400"
                />
              </div>
            ) : (
              <div>
                <label htmlFor="joinId" className="block mb-1.5 text-sm font-medium text-surface-300">
                  Meeting ID
                </label>
                <input
                  id="joinId"
                  type="text"
                  placeholder="Enter meeting ID or paste link"
                  value={joinId}
                  onChange={(e) => {
                    setJoinId(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, joinId: '' }));
                  }}
                  className={`w-full bg-surface-800 border rounded-lg px-4 py-2.5 text-surface-50 placeholder-surface-500 focus:outline-none focus:border-accent-400 ${
                    fieldErrors.joinId ? 'border-danger' : 'border-surface-600'
                  }`}
                />
                {fieldErrors.joinId && (
                  <p className="mt-1 text-xs text-danger-light">{fieldErrors.joinId}</p>
                )}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className={`w-full font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50 ${
                mode === 'create'
                  ? 'bg-accent-400 hover:bg-accent-500 text-surface-950'
                  : 'bg-surface-700 hover:bg-surface-600 text-surface-50'
              }`}
            >
              {isLoading
                ? mode === 'create' ? 'Creating...' : 'Joining...'
                : mode === 'create' ? 'Create Session' : 'Join Session'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
