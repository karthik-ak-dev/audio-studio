import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ProcessingCompletePayload, Recording } from '../shared';
import QualityBadge from '@/components/QualityBadge';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function Results() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [processingResult, setProcessingResult] = useState<ProcessingCompletePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchRecordings() {
      try {
        const res = await fetch(`${API_BASE}/recordings/${roomId}`);
        if (res.ok) {
          setRecordings(await res.json());
        }
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    }
    fetchRecordings();
  }, [roomId]);

  const handleDownload = async (recording: Recording) => {
    const res = await fetch(
      `${API_BASE}/recordings/${roomId}/download/${encodeURIComponent(recording.recordingId)}`,
    );
    if (res.ok) {
      const { downloadUrl } = await res.json();
      window.open(downloadUrl, '_blank');
    }
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Recording Results</h1>
            <p className="text-gray-400 text-sm mt-1">Room: {roomId}</p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors"
          >
            Back to Home
          </button>
        </div>

        {/* Quality profile */}
        {processingResult && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Quality Assessment</h2>
            <QualityBadge profile={processingResult.profile} />

            <div className="grid grid-cols-2 gap-4 text-sm">
              {Object.entries(processingResult.metrics).map(([key, value]) => (
                <div key={key} className="bg-gray-800 rounded-lg px-4 py-3">
                  <div className="text-gray-400">{key}</div>
                  <div className="text-white font-mono text-lg">{typeof value === 'number' ? value.toFixed(2) : value}</div>
                </div>
              ))}
            </div>

            {processingResult.warnings.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-gray-400">Notes</h3>
                {processingResult.warnings.map((w, i) => (
                  <p key={i} className="text-sm text-yellow-300">{w}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recordings list */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Recordings</h2>

          {isLoading ? (
            <p className="text-gray-500 text-sm">Loading recordings...</p>
          ) : recordings.length === 0 ? (
            <p className="text-gray-500 text-sm">No recordings found for this room.</p>
          ) : (
            <div className="space-y-3">
              {recordings.map((rec) => (
                <div
                  key={rec.recordingId}
                  className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3"
                >
                  <div>
                    <div className="text-white font-medium">{rec.participantName}</div>
                    <div className="text-sm text-gray-400">
                      {rec.status} &middot; {new Date(rec.uploadedAt).toLocaleString()}
                    </div>
                  </div>
                  {rec.status === 'completed' && (
                    <button
                      onClick={() => handleDownload(rec)}
                      className="px-3 py-1.5 bg-studio-600 hover:bg-studio-700 text-white text-sm rounded-lg transition-colors"
                    >
                      Download
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
