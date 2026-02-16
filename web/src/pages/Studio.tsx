/**
 * Studio.tsx — Main recording session page.
 *
 * This is the core of the application where the actual recording happens.
 * It orchestrates several subsystems simultaneously:
 *
 * ## User Journey
 *   Home → GreenRoom → **Studio (this page)** → Results
 *
 * ## Subsystems Managed
 *
 * 1. **Socket.IO (useSocket)** — Connects to the server, joins the room,
 *    and handles all real-time events: peer join/leave, recording start/stop,
 *    WebRTC signaling, recording warnings, quality updates, and chat.
 *
 * 2. **WebRTC (useWebRTC)** — Establishes a peer-to-peer audio connection
 *    with the other participant so both can hear each other in real-time.
 *    This is separate from the recording — WebRTC is for live monitoring,
 *    while the recorder captures lossless local audio.
 *
 * 3. **Local Recording (useRecorder)** — Captures the user's mic to a
 *    WAV file (48kHz 16-bit PCM) using AudioWorklet, with IndexedDB
 *    backup for crash recovery. Each participant records their own audio
 *    independently for maximum quality.
 *
 * 4. **Audio Metrics (useAudioMetrics)** — Real-time RMS/peak/clipping
 *    analysis displayed in the VolumeIndicator, and sent to the server
 *    every 5 seconds during recording for live quality monitoring.
 *
 * 5. **Upload (useUpload)** — After recording stops, uploads the WAV blob
 *    to S3 via the server's presigned URL flow. Supports multipart upload
 *    for large files (>10MB) with resume capability.
 *
 * ## Recording Flow
 *
 * 1. Host clicks "Start Recording"
 * 2. Client emits `start-recording { roomId }` to server
 * 3. Server generates a sessionId UUID and broadcasts `start-recording { sessionId }`
 * 4. Both clients begin local recording via AudioWorklet
 * 5. Every 5s, clients send `audio-metrics` with RMS/peak/clip/silence data
 * 6. Server analyzes metrics and may send `recording-warning` or `quality-update`
 * 7. Host clicks "Stop Recording"
 * 8. Client emits `stop-recording { roomId }` to server
 * 9. Server broadcasts `stop-recording` to all
 * 10. Both clients stop recording, encode WAV, and upload to S3
 * 11. After both uploads complete, server triggers processing pipeline via SQS
 *
 * ## Backend Events Used
 *
 * Client → Server:
 *   `join-room`        — { roomId, role, userId, userEmail? }
 *   `start-recording`  — { roomId }
 *   `stop-recording`   — { roomId }
 *   `audio-metrics`    — { sessionId, timestamp, rms, peak, clipCount, silenceDuration, speechDetected }
 *   `chat-message`     — { roomId, message, sender, role }
 *   `upload-progress`  — { percent, participantName }
 *   `offer/answer/ice-candidate` — WebRTC signaling (relayed by server)
 *
 * Server → Client:
 *   `room-state`         — Full room snapshot on join
 *   `user-joined`        — When peer joins
 *   `user-left`          — When peer disconnects
 *   `peer-reconnected`   — When peer reconnects (new socket ID)
 *   `start-recording`    — Recording begun with { sessionId }
 *   `stop-recording`     — Recording ended
 *   `resume-recording`   — Sent to reconnecting client if recording is active
 *   `recording-warning`  — Real-time quality alerts (clipping, too loud, silence, etc.)
 *   `quality-update`     — Aggregated quality profile estimate (P0-P4)
 *   `room-full`          — Room at capacity (2), client should redirect
 *   `duplicate-session`  — Same user opened a second tab
 *
 * ## REST Endpoints Used (via upload)
 *   POST /api/upload/url       — Get presigned S3 PUT URL (simple upload)
 *   POST /api/upload/complete  — Mark upload as complete in DynamoDB
 *   POST /api/multipart-upload/initiate  — Start multipart upload
 *   POST /api/multipart-upload/part-1    — Part 1 temp URL for WAV header
 *   POST /api/multipart-upload/part-url  — Presigned URL for parts 2-N
 *   POST /api/multipart-upload/complete  — Finalize multipart upload
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { RecordingWarningPayload, QualityUpdatePayload } from '../shared';
import { useSocket } from '@/hooks/useSocket';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useRecorder } from '@/hooks/useRecorder';
import { useUpload } from '@/hooks/useUpload';
import VolumeIndicator from '@/components/VolumeIndicator';
import QualityBadge from '@/components/QualityBadge';
import WarningBanner from '@/components/WarningBanner';
import UploadProgress from '@/components/UploadProgress';
import ChatPanel from '@/components/ChatPanel';
import { useAudioMetrics } from '@/hooks/useAudioMetrics';
import { SOCKET_EVENTS } from '../shared';
import { getPendingRecordings, clearChunks } from '@/services/storageService';
import type { PendingRecording } from '@/services/storageService';

export default function Studio() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  /** Local mic MediaStream — acquired on mount, used for metrics + recording + WebRTC */
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  /** Active recording warnings from server (kept to last 5) */
  const [warnings, setWarnings] = useState<RecordingWarningPayload[]>([]);

  /** Latest aggregated quality estimate from server (P0-P4) */
  const [qualityUpdate, setQualityUpdate] = useState<QualityUpdatePayload | null>(null);

  /** Chat message history for this session */
  const [chatMessages, setChatMessages] = useState<any[]>([]);

  /**
   * Current recording session ID — set when recording starts, cleared on stop.
   * Used as a ref too so async callbacks always see the latest value.
   */
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  /** Recoverable recordings from IndexedDB (from a previous crashed session) */
  const [pendingRecovery, setPendingRecovery] = useState<PendingRecording[]>([]);

  /** Audio elements for remote peer playback */
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  /**
   * Persistent user ID — stored in localStorage so the server can detect
   * reconnections (same userId, new socketId) vs. new users.
   */
  const userId = useRef(localStorage.getItem('userId') || `user_${crypto.randomUUID()}`);
  useEffect(() => {
    localStorage.setItem('userId', userId.current);
  }, []);

  /**
   * On mount, check IndexedDB for recording chunks from a crashed session.
   * If found, show a recovery banner so the user can re-encode and upload.
   */
  useEffect(() => {
    getPendingRecordings().then((pending) => {
      if (pending.length > 0) {
        setPendingRecovery(pending);
      }
    }).catch(() => {});
  }, []);

  const { metrics, startMetrics, stopMetrics } = useAudioMetrics();
  const recorder = useRecorder();
  const upload = useUpload();
  const webrtc = useWebRTC();

  /**
   * Recover a crashed recording: re-encode chunks from IndexedDB into
   * a WAV blob and upload it via the normal upload pipeline.
   */
  const handleRecover = useCallback(async (sessionKey: string) => {
    const blob = await recorder.recover(sessionKey);
    if (blob && roomId) {
      await upload.upload(blob, roomId, userId.current, sessionIdRef.current || undefined);
    }
    setPendingRecovery((prev) => prev.filter((p) => p.sessionKey !== sessionKey));
  }, [roomId, upload, recorder]);

  /** Discard a crashed recording — clears its chunks from IndexedDB */
  const handleDismissRecovery = useCallback(async (sessionKey: string) => {
    await clearChunks(sessionKey);
    setPendingRecovery((prev) => prev.filter((p) => p.sessionKey !== sessionKey));
  }, []);

  /**
   * Initialize Socket.IO connection with all event callbacks.
   *
   * The useSocket hook manages:
   *   - Connecting to the server (singleton socket)
   *   - Listening for all room/recording/signaling events
   *   - Providing emit methods (joinRoom, startRecording, etc.)
   *
   * Callbacks are wired to orchestrate the other subsystems:
   *   - onUserJoined → create WebRTC connection (send offer)
   *   - onUserLeft → close WebRTC connection
   *   - onPeerReconnected → tear down old connection, create new one
   *   - onStartRecording → begin local recording via AudioWorklet
   *   - onStopRecording → stop recording, encode WAV, upload to S3
   *   - onOffer/onAnswer/onIceCandidate → WebRTC signaling
   */
  const {
    socket,
    isConnected,
    roomState,
    error,
    joinRoom,
    startRecording: emitStartRecording,
    stopRecording: emitStopRecording,
    sendChat,
  } = useSocket(
    {
      roomId: roomId || '',
      role: 'host', // Initial role — server may reassign based on join order
      userId: userId.current,
    },
    {
      /**
       * When a new peer joins (not reconnection), initiate a WebRTC connection.
       * The joining user creates an offer; the existing user will receive it
       * and respond with an answer.
       */
      onUserJoined: (data) => {
        if (!data.isReconnection && localStream && socket) {
          webrtc.initConnection(socket, data.userId, localStream);
        }
      },

      /** Peer disconnected — clean up WebRTC resources */
      onUserLeft: () => {
        webrtc.closeConnection();
      },

      /**
       * Peer reconnected with a new socket ID (e.g. page refresh, network drop).
       * Must tear down the old RTCPeerConnection and create a new one targeting
       * the new socket ID — the old one is now invalid.
       */
      onPeerReconnected: (data) => {
        if (localStream && socket) {
          webrtc.closeConnection();
          webrtc.initConnection(socket, data.newSocketId, localStream);
        }
      },

      /**
       * Recording started — server generated a sessionId.
       * Start local audio capture via AudioWorklet. The session key format
       * is `roomId:userId:sessionId` for IndexedDB recovery identification.
       */
      onStartRecording: async (data) => {
        setSessionId(data.sessionId);
        sessionIdRef.current = data.sessionId;
        setWarnings([]);
        if (localStream) {
          const key = `${roomId}:${userId.current}:${data.sessionId}`;
          await recorder.start(localStream, key);
        }
      },

      /**
       * Recording stopped — encode WAV blob and upload to S3.
       * Uses sessionIdRef (not sessionId state) to avoid stale closure issues.
       */
      onStopRecording: async () => {
        const blob = recorder.stop();
        if (blob && roomId) {
          await upload.upload(blob, roomId, userId.current, sessionIdRef.current || undefined);
        }
        setSessionId(null);
        sessionIdRef.current = null;
      },

      /**
       * Sent by server when a user reconnects during an active recording.
       * Resume local capture so this client doesn't miss audio data.
       */
      onResumeRecording: async (data) => {
        setSessionId(data.sessionId);
        sessionIdRef.current = data.sessionId;
        if (localStream && !recorder.isRecording) {
          const key = `${roomId}:${userId.current}:${data.sessionId}`;
          await recorder.start(localStream, key);
        }
      },

      /**
       * Server detected a quality issue — store for display.
       * We keep a rolling window of the last 5 warnings to avoid
       * overwhelming the UI during a noisy recording.
       */
      onRecordingWarning: (data) => {
        setWarnings((prev) => [...prev.slice(-4), data]);
      },

      /** Server's aggregated quality estimate — updates the header badge */
      onQualityUpdate: (data) => {
        setQualityUpdate(data);
      },

      /**
       * Incoming WebRTC offer from peer — create a PeerConnection,
       * set remote description, and send back an answer.
       */
      onOffer: async (data) => {
        if (localStream && socket) {
          await webrtc.handleIncomingOffer(socket, data.sdp, data.sender, localStream);
        }
      },

      /** Set the remote answer on our PeerConnection */
      onAnswer: async (data) => {
        await webrtc.handleIncomingAnswer(data.sdp);
      },

      /** Add an ICE candidate (or queue it if remote description not set yet) */
      onIceCandidate: async (data) => {
        await webrtc.handleIncomingIceCandidate(data.candidate);
      },

      /** Room is full (2 participants already) — redirect to home */
      onRoomFull: () => {
        navigate('/');
      },

      /** Incoming chat message from peer */
      onChatMessage: (data) => {
        setChatMessages((prev) => [...prev, data]);
      },
    },
  );

  /**
   * Acquire the local microphone stream on mount.
   *
   * Audio constraints match the GreenRoom and recording pipeline:
   *   - echoCancellation: false → raw audio for dataset quality
   *   - noiseSuppression: false → preserves natural audio characteristics
   *   - sampleRate: 48000 → CD-quality for the WAV recording
   *
   * The stream is used by three systems simultaneously:
   *   1. useAudioMetrics — for real-time level visualization
   *   2. useRecorder — for lossless WAV capture
   *   3. useWebRTC — for live monitoring by the peer
   */
  useEffect(() => {
    async function getMic() {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 48000,
        },
      });
      setLocalStream(stream);
      startMetrics(stream);
    }
    getMic();

    return () => {
      localStream?.getTracks().forEach((t) => t.stop());
      stopMetrics();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Join the room once socket is connected AND mic stream is ready.
   * Both conditions must be met — the server needs the userId to create
   * a DynamoDB Session entry, and we need the stream ready for WebRTC
   * offer/answer flows that may happen immediately after join.
   */
  useEffect(() => {
    if (isConnected && localStream) {
      joinRoom();
    }
  }, [isConnected, localStream, joinRoom]);

  /** Attach remote peer's audio stream to the hidden <audio> element for playback */
  useEffect(() => {
    if (webrtc.remoteStream && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = webrtc.remoteStream;
    }
  }, [webrtc.remoteStream]);

  /**
   * During an active recording, send audio metrics to the server every 5 seconds.
   *
   * The server's metricsService ingests these to:
   *   - Maintain running averages per speaker
   *   - Detect quality issues (clipping, silence, overlap)
   *   - Estimate a live quality profile (P0-P4)
   *   - Broadcast recording-warning and quality-update events
   */
  useEffect(() => {
    if (!recorder.isRecording || !metrics || !socket || !sessionId) return;

    const interval = setInterval(() => {
      socket.emit(SOCKET_EVENTS.AUDIO_METRICS, {
        sessionId,
        timestamp: Date.now(),
        rms: metrics.rms,
        peak: metrics.peak,
        clipCount: metrics.clipCount,
        silenceDuration: metrics.silenceDuration,
        speechDetected: metrics.speechDetected,
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [recorder.isRecording, metrics, socket, sessionId]);

  /** Format recording duration as MM:SS */
  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const participants = roomState?.participants || [];
  const peerConnected = participants.length > 1;

  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Header bar ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800">
        <div>
          <h1 className="text-lg font-semibold text-white">
            {roomState?.meeting?.title || 'Audio Studio'}
          </h1>
          <p className="text-xs text-gray-500">Room: {roomId}</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Live quality profile badge — shown during recording */}
          {qualityUpdate && <QualityBadge profile={qualityUpdate.estimatedProfile} />}
          {/* Connection indicator: green = connected, red = disconnected */}
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
        </div>
      </header>

      {/* ── Error banner ───────────────────────────────────────────── */}
      {error && (
        <div className="px-6 py-2 text-sm text-red-200 border-b border-red-500 bg-red-900/50">
          {error}
        </div>
      )}

      {/* ── Crash recovery banner ──────────────────────────────────── */}
      {pendingRecovery.length > 0 && (
        <div className="px-6 py-3 text-sm text-yellow-200 border-b border-yellow-600 bg-yellow-900/50">
          <p className="mb-2 font-medium">Unsaved recording found from a previous session</p>
          {pendingRecovery.map((p) => (
            <div key={p.sessionKey} className="flex items-center gap-3">
              <span>{p.chunkCount} chunks recorded</span>
              <button
                onClick={() => handleRecover(p.sessionKey)}
                className="underline hover:text-yellow-100"
              >
                Recover & Upload
              </button>
              <button
                onClick={() => handleDismissRecovery(p.sessionKey)}
                className="text-yellow-400 underline hover:text-yellow-100"
              >
                Discard
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Main content area ──────────────────────────────────────── */}
      <div className="flex flex-1">
        {/* Left panel — recording controls + metrics */}
        <div className="flex-1 p-6 space-y-6">
          {/* ── Participant cards ─────────────────────────────────── */}
          <div className="flex gap-4">
            {participants.map((p) => (
              <div key={p.socketId} className="flex-1 px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg">
                <div className="mb-1 text-sm text-gray-400">{p.role}</div>
                <div className="font-medium text-white">{p.userEmail || p.userId}</div>
              </div>
            ))}
            {/* Placeholder shown when waiting for the second participant */}
            {participants.length < 2 && (
              <div className="flex items-center justify-center flex-1 px-4 py-3 text-sm text-gray-600 bg-gray-900 border border-gray-800 border-dashed rounded-lg">
                Waiting for partner...
              </div>
            )}
          </div>

          {/* ── Local audio level meter ──────────────────────────── */}
          {metrics && (
            <div>
              <label className="block mb-2 text-sm text-gray-400">Your Audio Level</label>
              <VolumeIndicator
                rmsDb={metrics.smoothRms}
                peakDb={metrics.smoothPeak}
                isClipping={metrics.clipCount > 0}
              />
            </div>
          )}

          {/* ── Recording controls ───────────────────────────────── */}
          <div className="flex items-center gap-4">
            {recorder.isRecording ? (
              <>
                <button
                  onClick={emitStopRecording}
                  className="px-6 py-3 font-medium text-white transition-colors bg-red-600 rounded-lg hover:bg-red-700"
                >
                  Stop Recording
                </button>
                {/* Pulsing red dot + duration timer */}
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                  <span className="font-mono text-lg text-white">
                    {formatDuration(recorder.recordingDuration)}
                  </span>
                </div>
              </>
            ) : (
              <button
                onClick={emitStartRecording}
                disabled={!peerConnected}
                className="px-6 py-3 font-medium text-white transition-colors rounded-lg bg-studio-600 hover:bg-studio-700 disabled:opacity-50"
              >
                {peerConnected ? 'Start Recording' : 'Waiting for partner...'}
              </button>
            )}
          </div>

          {/* ── Recording quality warnings from server ────────────── */}
          <WarningBanner warnings={warnings} />

          {/* ── Upload progress bar ──────────────────────────────── */}
          <UploadProgress
            progress={upload.progress}
            isUploading={upload.isUploading}
            error={upload.uploadError}
          />

          {/* ── Navigate to results after upload ─────────────────── */}
          {!upload.isUploading && upload.progress && upload.progress.percent === 100 && (
            <button
              onClick={() => navigate(`/room/${roomId}/results`)}
              className="w-full py-3 font-medium text-white transition-colors rounded-lg bg-studio-600 hover:bg-studio-700"
            >
              View Results
            </button>
          )}
        </div>

        {/* Right panel — chat sidebar */}
        <div className="p-4 border-l border-gray-800 w-80">
          <ChatPanel
            messages={chatMessages}
            onSend={sendChat}
            currentUserId={userId.current}
          />
        </div>
      </div>

      {/* Hidden audio element for playing the remote peer's stream */}
      <audio ref={remoteAudioRef} autoPlay />
    </div>
  );
}
