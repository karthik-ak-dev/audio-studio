/**
 * Results.tsx — Recording results and quality assessment page.
 *
 * This is the final step in the user journey:
 *   Home → GreenRoom → Studio → **Results (this page)**
 *
 * ## What it does
 *
 * 1. **Fetches recordings** — On mount, calls GET /api/recordings/:meetingId
 *    to retrieve all Recording entries for this room from DynamoDB.
 *    Each recording has: participantName, sessionId, status, uploadedAt.
 *
 * 2. **Listens for processing results** — Connects to Socket.IO and joins
 *    the room to receive real-time `processing-complete` and `recording-rejected`
 *    events from the server's SQS result consumer. These events arrive after
 *    the external processing pipeline finishes analyzing both audio files.
 *
 * 3. **Displays quality profile** — When processing results arrive, shows
 *    the quality classification (P0-P4) via QualityBadge, detailed metrics
 *    (SNR, RMS, SRMR, overlap, speaker balance, echo), and any warnings.
 *
 * 4. **Download recordings** — Each completed recording has a download button
 *    that calls GET /api/recordings/:meetingId/download/:recordingId to get
 *    a presigned S3 download URL (valid for 1 hour), then opens it.
 *
 * ## Backend Endpoints Used
 *
 *   GET /api/recordings/:meetingId
 *     → Returns Recording[] for this room
 *
 *   GET /api/recordings/:meetingId/download/:recordingId
 *     → Returns { downloadUrl } (presigned S3 URL, 1-hour expiry)
 *
 * ## Socket.IO Events
 *
 *   Client → Server:
 *     `join-room` — { roomId, role, userId } (to receive processing updates)
 *
 *   Server → Client:
 *     `processing-status`   — { step, progress, estimatedTimeLeft }
 *     `processing-complete`  — { profile, metrics, variants, warnings }
 *     `recording-rejected`   — { reason, suggestions }
 */

import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ProcessingCompletePayload, Recording } from '../shared';
import { SOCKET_EVENTS } from '../shared';
import QualityBadge from '@/components/QualityBadge';
import { connectSocket, disconnectSocket } from '@/services/socketService';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function Results() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  /** List of recording entries from DynamoDB */
  const [recordings, setRecordings] = useState<Recording[]>([]);

  /** Processing result from the external pipeline (via SQS → Socket.IO) */
  const [processingResult, setProcessingResult] = useState<ProcessingCompletePayload | null>(null);

  /** Whether a processing rejection was received */
  const [rejection, setRejection] = useState<{ reason: string; suggestions: string[] } | null>(null);

  /** Processing pipeline progress */
  const [processingStatus, setProcessingStatus] = useState<{
    step: string;
    progress: number;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(true);

  /** Persistent userId for socket join */
  const userId = useRef(localStorage.getItem('userId') || `user_${crypto.randomUUID()}`);

  /**
   * Fetch recordings from the REST API on mount.
   * This returns all Recording entries for the meetingId regardless of session.
   */
  useEffect(() => {
    async function fetchRecordings() {
      try {
        const res = await fetch(`${API_BASE}/recordings/${roomId}`);
        if (res.ok) {
          setRecordings(await res.json());
        }
      } catch {
        // Network error — recordings list will show as empty
      } finally {
        setIsLoading(false);
      }
    }
    fetchRecordings();
  }, [roomId]);

  /**
   * Connect to Socket.IO and join the room to receive processing results.
   *
   * The server's processingResultConsumer polls SQS for results from the
   * external processing pipeline. When a result arrives, it emits either:
   *   - `processing-complete` with quality profile + metrics
   *   - `recording-rejected` with reason + suggestions
   *
   * We also listen for `processing-status` for real-time progress updates
   * during the pipeline execution.
   */
  useEffect(() => {
    const socket = connectSocket();

    // Join the room so we receive events targeted at this room
    socket.emit(SOCKET_EVENTS.JOIN_ROOM, {
      roomId,
      role: 'host',
      userId: userId.current,
    });

    // Processing pipeline progress updates
    socket.on(SOCKET_EVENTS.PROCESSING_STATUS, (data: any) => {
      setProcessingStatus({ step: data.step, progress: data.progress });
    });

    // Final processing result — quality profile and detailed metrics
    socket.on(SOCKET_EVENTS.PROCESSING_COMPLETE, (data: ProcessingCompletePayload) => {
      setProcessingResult(data);
      setProcessingStatus(null);
    });

    // Processing rejection — audio quality too low
    socket.on(SOCKET_EVENTS.RECORDING_REJECTED, (data: any) => {
      setRejection({ reason: data.reason, suggestions: data.suggestions });
      setProcessingStatus(null);
    });

    // Also refresh recordings list when processing triggers an update
    socket.on(SOCKET_EVENTS.RECORDINGS_UPDATED, () => {
      fetch(`${API_BASE}/recordings/${roomId}`)
        .then((res) => (res.ok ? res.json() : []))
        .then(setRecordings)
        .catch(() => {});
    });

    return () => {
      socket.removeAllListeners();
      disconnectSocket();
    };
  }, [roomId]);

  /**
   * Download a recording via presigned S3 URL.
   * The server generates a 1-hour presigned GET URL and we open it
   * in a new tab to trigger the browser's download behavior.
   */
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
        {/* ── Page header with back navigation ────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Recording Results</h1>
            <p className="mt-1 text-sm text-gray-400">Room: {roomId}</p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 text-sm text-white transition-colors bg-gray-800 rounded-lg hover:bg-gray-700"
          >
            Back to Home
          </button>
        </div>

        {/* ── Processing progress (while pipeline is running) ─────── */}
        {processingStatus && (
          <div className="p-6 space-y-3 bg-gray-900 border border-gray-800 rounded-xl">
            <h2 className="text-lg font-semibold text-white">Processing Audio...</h2>
            <p className="text-sm text-gray-400">Step: {processingStatus.step}</p>
            <div className="h-2 overflow-hidden bg-gray-700 rounded-full">
              <div
                className="h-full transition-all duration-300 rounded-full bg-studio-500"
                style={{ width: `${processingStatus.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Quality assessment (after processing completes) ─────── */}
        {processingResult && (
          <div className="p-6 space-y-4 bg-gray-900 border border-gray-800 rounded-xl">
            <h2 className="text-lg font-semibold text-white">Quality Assessment</h2>
            <QualityBadge profile={processingResult.profile} />

            {/* Metrics grid — SNR, RMS, SRMR, overlap, speaker balance, echo, WVMOS */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              {Object.entries(processingResult.metrics).map(([key, value]) => (
                <div key={key} className="px-4 py-3 bg-gray-800 rounded-lg">
                  <div className="text-gray-400">{key}</div>
                  <div className="font-mono text-lg text-white">{typeof value === 'number' ? value.toFixed(2) : value}</div>
                </div>
              ))}
            </div>

            {/* Processing warnings/notes */}
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

        {/* ── Rejection notice (if recording quality too low) ─────── */}
        {rejection && (
          <div className="p-6 space-y-3 bg-red-900/30 border border-red-700 rounded-xl">
            <h2 className="text-lg font-semibold text-red-200">Recording Rejected</h2>
            <p className="text-sm text-red-300">{rejection.reason}</p>
            {rejection.suggestions.length > 0 && (
              <ul className="space-y-1 text-sm text-red-200">
                {rejection.suggestions.map((s, i) => (
                  <li key={i}>- {s}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Recordings list with download buttons ──────────────── */}
        <div className="p-6 space-y-4 bg-gray-900 border border-gray-800 rounded-xl">
          <h2 className="text-lg font-semibold text-white">Recordings</h2>

          {isLoading ? (
            <p className="text-sm text-gray-500">Loading recordings...</p>
          ) : recordings.length === 0 ? (
            <p className="text-sm text-gray-500">No recordings found for this room.</p>
          ) : (
            <div className="space-y-3">
              {recordings.map((rec) => (
                <div
                  key={rec.recordingId}
                  className="flex items-center justify-between px-4 py-3 bg-gray-800 rounded-lg"
                >
                  <div>
                    <div className="font-medium text-white">{rec.participantName}</div>
                    <div className="text-sm text-gray-400">
                      {rec.status} &middot; {new Date(rec.uploadedAt).toLocaleString()}
                    </div>
                  </div>
                  {/* Download button — only shown for completed uploads */}
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
