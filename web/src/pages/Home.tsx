import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMeeting } from '@/hooks/useMeeting';

export default function Home() {
  const navigate = useNavigate();
  const { createMeeting, isLoading, error } = useMeeting();
  const [title, setTitle] = useState('');
  const [joinId, setJoinId] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const meeting = await createMeeting(title || 'Untitled Session');
    navigate(`/room/${meeting.meetingId}/green-room`);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinId.trim()) {
      navigate(`/room/${joinId.trim()}/green-room`);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-2">Audio Studio</h1>
          <p className="text-gray-400">High-quality audio recording for dataset collection</p>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg px-4 py-3 text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Create new session */}
        <form onSubmit={handleCreate} className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
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

        {/* Join existing session */}
        <form onSubmit={handleJoin} className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
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
