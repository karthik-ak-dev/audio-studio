/**
 * GreenRoom.tsx — Step-by-step sound check before entering the recording studio.
 *
 * Guides the user through 3 sequential checks:
 *   1. Microphone — Device detected and stream acquired
 *   2. Level Check — Accumulated evidence that mic produces good levels
 *   3. Environment — Noise floor evaluation
 *
 * Uses accumulated evidence (rolling window of server responses) instead of
 * single-snapshot evaluation, so pauses between sentences don't reset progress.
 *
 * Flow: Home → GreenRoom (this page) → Studio → Results
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SOCKET_EVENTS } from '../shared';
import type { MicStatus } from '../shared';
import { useAudioMetrics } from '@/hooks/useAudioMetrics';
import VolumeIndicator from '@/components/VolumeIndicator';
import DeviceSelector from '@/components/DeviceSelector';
import { connectSocket, disconnectSocket } from '@/services/socketService';

// ── Types ────────────────────────────────────────────────────

type CheckPhase = 'device' | 'level' | 'environment' | 'ready';
type CheckStatus = 'pending' | 'active' | 'passed' | 'failed';

interface CheckState {
  device: CheckStatus;
  level: CheckStatus;
  environment: CheckStatus;
}

// ── Constants ────────────────────────────────────────────────

/** Number of mic-status responses to keep in the rolling window */
const HISTORY_SIZE = 6;
/** Number of "good" level responses needed to pass the level check */
const GOOD_THRESHOLD = 2;
/** Milliseconds before showing a hint if no good frames detected */
const LEVEL_HINT_DELAY = 10_000;
/** Minimum ms to show a step as active before auto-advancing */
const MIN_STEP_DISPLAY = 600;

// ── Component ────────────────────────────────────────────────

export default function GreenRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  // ── Device state ───────────────────────────────────────────
  const [deviceId, setDeviceId] = useState<string>('');
  const [deviceLabel, setDeviceLabel] = useState<string>('');
  const [stream, setStream] = useState<MediaStream | null>(null);

  // ── Phase state machine ────────────────────────────────────
  const [phase, setPhase] = useState<CheckPhase>('device');
  const [checkState, setCheckState] = useState<CheckState>({
    device: 'active',
    level: 'pending',
    environment: 'pending',
  });

  // ── Audio metrics ──────────────────────────────────────────
  const { metrics, startMetrics, stopMetrics } = useAudioMetrics();

  // ── Socket ─────────────────────────────────────────────────
  const socketRef = useRef(connectSocket());

  // ── Refs for interval access ───────────────────────────────
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  // ── Noise floor estimator (EMA on quiet frames) ────────────
  const noiseFloorRef = useRef(-60);
  useEffect(() => {
    if (!metrics) return;
    const rms = metrics.rms === -Infinity ? -80 : metrics.rms;
    const prev = noiseFloorRef.current;
    if (rms < -35) {
      noiseFloorRef.current = prev + 0.1 * (rms - prev);
    }
  }, [metrics]);

  // ── Evidence accumulation ──────────────────────────────────
  const statusHistoryRef = useRef<MicStatus[]>([]);
  const [goodFrameCount, setGoodFrameCount] = useState(0);
  const [latestStatus, setLatestStatus] = useState<MicStatus | null>(null);
  const [noiseResult, setNoiseResult] = useState<MicStatus['noiseFloor'] | null>(null);
  const [showLevelHint, setShowLevelHint] = useState(false);
  const levelHintTimerRef = useRef<number>(0);

  // ── Minimum display time guard ─────────────────────────────
  const phaseEnteredAtRef = useRef(Date.now());

  // ── Device change handler (resets all checks) ──────────────
  const handleDeviceChange = useCallback((newDeviceId: string) => {
    setDeviceId(newDeviceId);
    setPhase('device');
    setCheckState({ device: 'active', level: 'pending', environment: 'pending' });
    statusHistoryRef.current = [];
    setGoodFrameCount(0);
    setLatestStatus(null);
    setNoiseResult(null);
    setShowLevelHint(false);
    window.clearTimeout(levelHintTimerRef.current);
  }, []);

  // ── Acquire mic stream on device change ────────────────────
  useEffect(() => {
    if (!deviceId) return;

    let currentStream: MediaStream | null = null;

    async function getMic() {
      stream?.getTracks().forEach((t) => t.stop());
      stopMetrics();
      noiseFloorRef.current = -60;

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

      // Capture device label for display
      const track = s.getAudioTracks()[0];
      setDeviceLabel(track?.label || 'Microphone');
    }

    getMic();

    return () => {
      currentStream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Send mic-check to server every 1 second ────────────────
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const interval = setInterval(() => {
      const m = metricsRef.current;
      if (!m) return;

      socket.emit(SOCKET_EVENTS.MIC_CHECK, {
        rms: m.rms,
        peak: m.peak,
        noiseFloor: noiseFloorRef.current,
        isClipping: m.clipCount > 0,
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Listen for server mic-status responses ─────────────────
  useEffect(() => {
    const socket = socketRef.current;
    const handler = (data: MicStatus) => {
      setLatestStatus(data);

      // Only accumulate during level/environment phases
      if (phase !== 'level' && phase !== 'environment') return;

      statusHistoryRef.current = [
        ...statusHistoryRef.current.slice(-(HISTORY_SIZE - 1)),
        data,
      ];

      const good = statusHistoryRef.current.filter((s) => s.level === 'good').length;
      setGoodFrameCount(good);
      setNoiseResult(data.noiseFloor);
    };

    socket.on(SOCKET_EVENTS.MIC_STATUS, handler);
    return () => {
      socket.off(SOCKET_EVENTS.MIC_STATUS, handler);
    };
  }, [phase]);

  // ── Phase transitions ──────────────────────────────────────

  // device → level (when stream acquired)
  useEffect(() => {
    if (phase === 'device' && stream) {
      phaseEnteredAtRef.current = Date.now();
      setCheckState({ device: 'passed', level: 'active', environment: 'pending' });
      setPhase('level');
      levelHintTimerRef.current = window.setTimeout(
        () => setShowLevelHint(true),
        LEVEL_HINT_DELAY,
      );
    }
  }, [phase, stream]);

  // level → environment (when enough good frames)
  useEffect(() => {
    if (phase === 'level' && goodFrameCount >= GOOD_THRESHOLD) {
      window.clearTimeout(levelHintTimerRef.current);
      setShowLevelHint(false);

      const elapsed = Date.now() - phaseEnteredAtRef.current;
      const delay = Math.max(0, MIN_STEP_DISPLAY - elapsed);

      setTimeout(() => {
        phaseEnteredAtRef.current = Date.now();
        setCheckState((prev) => ({ ...prev, level: 'passed', environment: 'active' }));
        setPhase('environment');
      }, delay);
    }
  }, [phase, goodFrameCount]);

  // environment → ready (once noise result arrives)
  useEffect(() => {
    if (phase === 'environment' && noiseResult !== null) {
      const elapsed = Date.now() - phaseEnteredAtRef.current;
      const delay = Math.max(0, MIN_STEP_DISPLAY - elapsed);

      setTimeout(() => {
        if (noiseResult !== 'unacceptable') {
          setCheckState((prev) => ({ ...prev, environment: 'passed' }));
          setPhase('ready');
        } else {
          setCheckState((prev) => ({ ...prev, environment: 'failed' }));
        }
      }, delay);
    }
  }, [phase, noiseResult]);

  // ── Navigate to Studio ─────────────────────────────────────
  const handleReady = useCallback(() => {
    stopMetrics();
    stream?.getTracks().forEach((t) => t.stop());
    navigate(`/room/${roomId}`);
  }, [roomId, navigate, stopMetrics, stream]);

  // ── Retry environment check ────────────────────────────────
  const handleRetryEnvironment = useCallback(() => {
    statusHistoryRef.current = [];
    noiseFloorRef.current = -60;
    setNoiseResult(null);
    setCheckState((prev) => ({ ...prev, environment: 'active' }));
    setPhase('environment');
  }, []);

  // ── Cleanup on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => {
      stopMetrics();
      stream?.getTracks().forEach((t) => t.stop());
      disconnectSocket();
      window.clearTimeout(levelHintTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-xl space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="mb-1 text-2xl font-bold text-white">Sound Check</h1>
          <p className="text-sm text-gray-400">
            Let's make sure your microphone is working well
          </p>
        </div>

        <div className="p-6 bg-gray-900 border border-gray-800 rounded-xl">
          {/* Step 1: Microphone */}
          <StepItem
            stepNumber={1}
            label="Microphone"
            status={checkState.device}
            statusText={checkState.device === 'passed' ? deviceLabel : undefined}
            isLast={false}
          >
            <DeviceSelector
              onDeviceSelected={handleDeviceChange}
              selectedDeviceId={deviceId}
            />
          </StepItem>

          {/* Step 2: Level Check */}
          <StepItem
            stepNumber={2}
            label="Level Check"
            status={checkState.level}
            statusText={
              checkState.level === 'passed' ? 'Mic level sounds good' : undefined
            }
            isLast={false}
          >
            <div className="space-y-3">
              <p className="text-sm text-gray-300">
                {goodFrameCount === 0
                  ? 'Say something to test your microphone...'
                  : goodFrameCount < GOOD_THRESHOLD
                    ? 'Keep talking for a moment...'
                    : 'Your mic level is good!'}
              </p>

              {metrics && (
                <VolumeIndicator
                  rmsDb={metrics.smoothRms}
                  peakDb={metrics.smoothPeak}
                  isClipping={metrics.clipCount > 0}
                  hideLabels
                />
              )}

              {/* Evidence dots */}
              <div className="flex items-center gap-1.5">
                {Array.from({ length: GOOD_THRESHOLD }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                      i < goodFrameCount ? 'bg-green-400' : 'bg-gray-700'
                    }`}
                  />
                ))}
                <span className="ml-1 text-xs text-gray-600">
                  {goodFrameCount}/{GOOD_THRESHOLD}
                </span>
              </div>

              {/* Hint after timeout with no good frames */}
              {showLevelHint && latestStatus && (
                <div className="px-3 py-2 text-sm border rounded-lg bg-yellow-950/30 border-yellow-800/40 text-yellow-300">
                  {latestStatus.level === 'too-quiet'
                    ? 'We can barely hear you. Try moving closer to your microphone or increasing the input volume.'
                    : latestStatus.level === 'too-loud'
                      ? 'Your microphone is too loud. Try moving back or reducing the input volume.'
                      : 'Try speaking at a normal conversational volume.'}
                </div>
              )}
            </div>
          </StepItem>

          {/* Step 3: Environment */}
          <StepItem
            stepNumber={3}
            label="Environment"
            status={checkState.environment}
            statusText={
              checkState.environment === 'passed'
                ? noiseResult === 'noisy'
                  ? 'Some background noise -- consider a quieter room'
                  : 'Your room sounds quiet'
                : checkState.environment === 'failed'
                  ? 'Too much background noise'
                  : undefined
            }
            isLast
          >
            {checkState.environment === 'active' && (
              <p className="text-sm text-gray-400">Checking background noise...</p>
            )}
            {checkState.environment === 'failed' && (
              <div className="space-y-2">
                <p className="text-sm text-red-300">
                  Please move to a quieter space. Background noise will affect
                  recording quality.
                </p>
                <button
                  onClick={handleRetryEnvironment}
                  className="px-3 py-1.5 text-sm text-white rounded-md bg-gray-700 hover:bg-gray-600"
                >
                  Retry
                </button>
              </div>
            )}
          </StepItem>

          {/* Ready button */}
          <div className="pt-4 mt-2 border-t border-gray-800">
            <button
              onClick={handleReady}
              disabled={phase !== 'ready'}
              className={`w-full py-3 font-medium text-white rounded-lg transition-all ${
                phase === 'ready'
                  ? 'bg-studio-600 hover:bg-studio-700 shadow-lg shadow-studio-600/20'
                  : 'bg-gray-700 opacity-60 cursor-not-allowed'
              }`}
            >
              {phase === 'ready'
                ? "I'm Ready"
                : phase === 'device'
                  ? 'Select a microphone'
                  : checkState.environment === 'failed'
                    ? 'Fix issues above to continue'
                    : 'Complete the checks above'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── StepItem Component ───────────────────────────────────────

function StepItem({
  stepNumber,
  label,
  status,
  statusText,
  isLast,
  children,
}: {
  stepNumber: number;
  label: string;
  status: CheckStatus;
  statusText?: string;
  isLast: boolean;
  children?: React.ReactNode;
}) {
  const isExpanded = status === 'active' || status === 'failed';

  const iconStyle = {
    pending: 'bg-gray-700 text-gray-500',
    active: 'bg-studio-600 text-white ring-2 ring-studio-400/30',
    passed: 'bg-green-600 text-white',
    failed: 'bg-red-600 text-white',
  }[status];

  const icon = {
    pending: String(stepNumber),
    active: String(stepNumber),
    passed: '\u2713',
    failed: '\u2717',
  }[status];

  return (
    <div className={`relative pl-10 ${isLast ? '' : 'pb-6'}`}>
      {/* Vertical connector line */}
      {!isLast && (
        <div className="absolute left-[15px] top-8 bottom-0 w-px bg-gray-800" />
      )}

      {/* Step circle */}
      <div
        className={`absolute left-0 top-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${iconStyle}`}
      >
        {icon}
      </div>

      {/* Label row */}
      <div className="flex items-center gap-2 h-8">
        <span
          className={`font-medium ${
            status === 'pending' ? 'text-gray-500' : 'text-white'
          }`}
        >
          {label}
        </span>
        {statusText && (
          <span className="text-sm text-gray-400">&middot; {statusText}</span>
        )}
      </div>

      {/* Expandable content */}
      {isExpanded && children && <div className="mt-3">{children}</div>}
    </div>
  );
}
