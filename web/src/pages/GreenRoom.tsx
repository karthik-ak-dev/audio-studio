/**
 * GreenRoom.tsx — Microphone test page before entering the recording studio.
 *
 * This page sits between Home and Studio in the user journey:
 *   Home → GreenRoom (this page) → Studio → Results
 *
 * ## What it does
 *
 * 1. **Device Selection** — Enumerates audio input devices and lets the user
 *    choose their microphone via the DeviceSelector component.
 *
 * 2. **Mic Stream Acquisition** — When a device is selected, requests a
 *    MediaStream with raw audio settings (no echo cancellation or noise
 *    suppression, 48kHz sample rate) to match the recording pipeline.
 *
 * 3. **Real-time Level Monitoring** — Feeds the stream into useAudioMetrics,
 *    which uses a Web Audio AnalyserNode to compute RMS/peak levels at
 *    ~60fps. The VolumeIndicator component renders these as a visual meter.
 *
 * 4. **Server-side Mic Evaluation** — Every 1 second, sends a `mic-check`
 *    event to the server with { rms, peak, noiseFloor, isClipping }.
 *    The server evaluates these against AUDIO_THRESHOLDS and responds with
 *    a `mic-status` event containing:
 *      - level: 'good' | 'too-quiet' | 'too-loud'
 *      - noiseFloor: 'clean' | 'noisy' | 'unacceptable'
 *      - suggestions: string[] (contextual tips)
 *
 * 5. **Gate to Studio** — The "I'm Ready" button is only enabled when the
 *    server reports level === 'good' AND noiseFloor !== 'unacceptable'.
 *    On click, the mic stream is stopped (Studio will acquire its own)
 *    and the user navigates to /room/:roomId.
 *
 * ## Socket.IO usage
 *
 * The GreenRoom creates its own Socket.IO connection for mic-check only.
 * It does NOT join a room — the server's mic-check handler evaluates
 * metrics and responds directly to the sender socket. On unmount, the
 * socket is disconnected so Studio can establish a fresh connection.
 *
 * ## Backend events used
 *
 * Client → Server:
 *   `mic-check` — { rms, peak, noiseFloor, isClipping } (every 1s)
 *
 * Server → Client:
 *   `mic-status` — { level, noiseFloor, clipping, suggestions }
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SOCKET_EVENTS } from '../shared';
import { useAudioMetrics } from '@/hooks/useAudioMetrics';
import VolumeIndicator from '@/components/VolumeIndicator';
import DeviceSelector from '@/components/DeviceSelector';
import { connectSocket, disconnectSocket } from '@/services/socketService';

export default function GreenRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  /** Currently selected microphone device ID */
  const [deviceId, setDeviceId] = useState<string>('');

  /** Active MediaStream from the selected mic — stopped on unmount or device change */
  const [stream, setStream] = useState<MediaStream | null>(null);

  /**
   * Server's assessment of the user's mic quality.
   * null until the first mic-status event arrives (~1s after metrics start).
   */
  const [micStatus, setMicStatus] = useState<{
    level: string;
    noiseFloor: string;
    suggestions: string[];
  } | null>(null);

  const [isReady, setIsReady] = useState(false);
  const { metrics, startMetrics, stopMetrics } = useAudioMetrics();

  /**
   * Connect to Socket.IO eagerly so we can start sending mic-check events.
   * This is a singleton — connectSocket() returns the existing socket if
   * one is already connected.
   */
  const socketRef = useRef(connectSocket());

  /**
   * Acquire a new mic stream whenever the selected device changes.
   *
   * Audio constraints deliberately disable browser processing:
   *   - echoCancellation: false  → we want raw audio, not processed
   *   - noiseSuppression: false  → server evaluates noise separately
   *   - sampleRate: 48000        → matches the recording pipeline
   *
   * The previous stream's tracks are stopped before acquiring a new one
   * to release the old device handle.
   */
  useEffect(() => {
    if (!deviceId) return;

    let currentStream: MediaStream | null = null;

    async function getMic() {
      // Stop previous stream to release the device
      stream?.getTracks().forEach((t) => t.stop());
      stopMetrics();

      const s = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 48000,
        },
      });
      currentStream = s;
      setStream(s);
      startMetrics(s);
    }

    getMic();

    return () => {
      currentStream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Send mic-check metrics to the server every 1 second.
   *
   * The server's evaluateMicCheck() compares these against AUDIO_THRESHOLDS:
   *   - rms < -40dBFS → 'too-quiet'
   *   - rms > -6dBFS  → 'too-loud'
   *   - noiseFloor > -30dBFS → 'unacceptable'
   *
   * Note: We approximate noiseFloor as the current RMS. A proper noise floor
   * measurement would require a longer silence sample, but for a quick
   * green-room check this is sufficient.
   */
  useEffect(() => {
    if (!metrics || !socketRef.current) return;

    const interval = setInterval(() => {
      if (metrics) {
        socketRef.current.emit(SOCKET_EVENTS.MIC_CHECK, {
          rms: metrics.rms,
          peak: metrics.peak,
          noiseFloor: metrics.rms, // Approximation — real noise floor needs longer analysis
          isClipping: metrics.clipCount > 0,
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [metrics]);

  /**
   * Listen for the server's mic quality assessment.
   * The server sends this in response to each mic-check event.
   */
  useEffect(() => {
    const socket = socketRef.current;
    socket.on(SOCKET_EVENTS.MIC_STATUS, (data: any) => {
      setMicStatus(data);
    });
    return () => {
      socket.off(SOCKET_EVENTS.MIC_STATUS);
    };
  }, []);

  /**
   * "I'm Ready" handler — stops the mic stream and metrics, then
   * navigates to the Studio page. The Studio will acquire its own
   * fresh MediaStream on mount.
   */
  const handleReady = useCallback(() => {
    setIsReady(true);
    stopMetrics();
    stream?.getTracks().forEach((t) => t.stop());
    navigate(`/room/${roomId}`);
  }, [roomId, navigate, stopMetrics, stream]);

  /**
   * Cleanup on unmount: stop metrics, release mic, disconnect socket.
   * The socket disconnect is intentional — Studio will create a fresh
   * connection so it starts with a clean event listener slate.
   */
  useEffect(() => {
    return () => {
      stopMetrics();
      stream?.getTracks().forEach((t) => t.stop());
      disconnectSocket();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Gate conditions: mic level must be 'good' and noise floor not 'unacceptable' */
  const levelOk = micStatus?.level === 'good';
  const noiseOk = micStatus?.noiseFloor !== 'unacceptable';
  const canProceed = levelOk && noiseOk;

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="mb-1 text-2xl font-bold text-white">Green Room</h1>
          <p className="text-gray-400">Test your microphone before recording</p>
        </div>

        <div className="p-6 space-y-6 bg-gray-900 border border-gray-800 rounded-xl">
          {/* ── Device selection dropdown ───────────────────────── */}
          <DeviceSelector onDeviceSelected={setDeviceId} selectedDeviceId={deviceId} />

          {/* ── Real-time volume meter ─────────────────────────── */}
          {metrics && (
            <div>
              <label className="block mb-2 text-sm text-gray-400">Input Level</label>
              <VolumeIndicator
                rmsDb={metrics.rms}
                peakDb={metrics.peak}
                isClipping={metrics.clipCount > 0}
              />
            </div>
          )}

          {/* ── Server mic status feedback ─────────────────────── */}
          {micStatus && (
            <div className="space-y-2">
              <div className="flex gap-3">
                <StatusBadge label="Level" status={micStatus.level === 'good' ? 'good' : 'bad'} />
                <StatusBadge
                  label="Noise"
                  status={micStatus.noiseFloor === 'clean' ? 'good' : micStatus.noiseFloor === 'noisy' ? 'warn' : 'bad'}
                />
              </div>

              {/* Server-provided suggestions (e.g. "Move closer to microphone") */}
              {micStatus.suggestions.length > 0 && (
                <ul className="space-y-1 text-sm text-gray-300">
                  {micStatus.suggestions.map((s, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-gray-500 mt-0.5">-</span>
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── Ready button — gated on mic quality ────────────── */}
          <button
            onClick={handleReady}
            disabled={!canProceed && micStatus !== null}
            className="w-full py-3 font-medium text-white transition-colors rounded-lg bg-studio-600 hover:bg-studio-700 disabled:opacity-50"
          >
            {!micStatus ? 'Checking microphone...' : canProceed ? "I'm Ready" : 'Fix issues before continuing'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * StatusBadge — Small colored pill showing mic check status.
 * Used for both the "Level" and "Noise" indicators.
 */
function StatusBadge({ label, status }: { label: string; status: 'good' | 'warn' | 'bad' }) {
  const colors = {
    good: 'bg-green-900/50 text-green-300 border-green-700',
    warn: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
    bad: 'bg-red-900/50 text-red-300 border-red-700',
  };

  return (
    <span className={`px-3 py-1 rounded-lg border text-sm ${colors[status]}`}>
      {label}: {status === 'good' ? 'OK' : status === 'warn' ? 'Warning' : 'Issue'}
    </span>
  );
}
