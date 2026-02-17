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
 *
 * Identity gate: If the user hasn't entered their name/email on the Home page
 * (e.g., they followed an invite link directly), they are redirected to Home
 * with `?room=roomId` so the Join Session tab is pre-filled.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  SOCKET_EVENTS, MIC_LEVEL, NOISE_FLOOR_LEVEL, SNR_LEVEL,
  SIGNAL_STABILITY, SPECTRAL_WARNING,
} from '../shared';
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

const DEV_SKIP = import.meta.env.VITE_SKIP_GREEN_ROOM === 'true';

export default function GreenRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  // ── Dev skip — bypass all green room checks ──────────────
  useEffect(() => {
    if (DEV_SKIP && roomId) {
      navigate(`/room/${roomId}`, { replace: true });
    }
  }, [roomId, navigate]);

  // ── Identity gate ─────────────────────────────────────────
  // Redirect to Home if user hasn't entered name/email yet.
  // This covers the case where a guest clicks an invite link directly.
  useEffect(() => {
    if (DEV_SKIP) return;
    const hasIdentity = localStorage.getItem('userName') && localStorage.getItem('userEmail');
    if (!hasIdentity && roomId) {
      navigate(`/?room=${roomId}`, { replace: true });
    }
  }, [roomId, navigate]);

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

  // ── Track whether we're navigating to Studio (clean exit) ──
  const navigatingToStudioRef = useRef(false);

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
        // Spectral analysis + stability metrics
        voiceBandEnergy: m.voiceBandEnergy,
        highFreqEnergy: m.highFreqEnergy,
        spectralFlatness: m.spectralFlatness,
        humDetected: m.humDetected,
        rmsStability: m.rmsStability,
        speechLikely: m.speechLikely,
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

      const good = statusHistoryRef.current.filter((s) => s.level === MIC_LEVEL.GOOD && s.speechVerified).length;
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

  // environment → ready (once noise result arrives + SNR check)
  useEffect(() => {
    if (phase === 'environment' && noiseResult !== null && latestStatus) {
      const elapsed = Date.now() - phaseEnteredAtRef.current;
      const delay = Math.max(0, MIN_STEP_DISPLAY - elapsed);

      const snrBlocking = latestStatus.snr === SNR_LEVEL.BLOCKING;
      const hasBlockingIssue = noiseResult === NOISE_FLOOR_LEVEL.UNACCEPTABLE || snrBlocking;

      setTimeout(() => {
        if (!hasBlockingIssue) {
          setCheckState((prev) => ({ ...prev, environment: 'passed' }));
          setPhase('ready');
        } else {
          setCheckState((prev) => ({ ...prev, environment: 'failed' }));
        }
      }, delay);
    }
  }, [phase, noiseResult, latestStatus]);

  // ── Navigate to Studio ─────────────────────────────────────
  const handleReady = useCallback(() => {
    navigatingToStudioRef.current = true;
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
      // Only disconnect the socket on unexpected unmount (back button, page close).
      // When navigating to Studio, the socket must stay alive for useSocket to reuse.
      if (!navigatingToStudioRef.current) {
        disconnectSocket();
      }
      window.clearTimeout(levelHintTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-xl space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="mb-1 text-2xl font-bold text-surface-50">Sound Check</h1>
          <p className="text-sm text-surface-400">
            Let's make sure your microphone is working well
          </p>
        </div>

        <div className="p-6 bg-surface-900 border border-surface-700 rounded-xl">
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
              checkState.level === 'passed' ? 'Mic level and speech verified' : undefined
            }
            isLast={false}
          >
            <div className="space-y-3">
              <p className="text-sm text-surface-200">
                {goodFrameCount === 0
                  ? 'Say a test phrase to check your microphone...'
                  : goodFrameCount < GOOD_THRESHOLD
                    ? 'Keep talking — verifying your audio...'
                    : 'Your mic level and speech quality are good!'}
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
                      i < goodFrameCount ? 'bg-success' : 'bg-surface-700'
                    }`}
                  />
                ))}
                <span className="ml-1 text-xs text-surface-500">
                  {goodFrameCount}/{GOOD_THRESHOLD}
                </span>
              </div>

              {/* Hint after timeout with no good frames */}
              {showLevelHint && latestStatus && (
                <div className="px-3 py-2 text-sm border rounded-lg bg-warning-dark/30 border-warning/40 text-warning">
                  {latestStatus.level === MIC_LEVEL.TOO_QUIET
                    ? 'We can barely hear you. Try moving closer to your microphone or increasing the input volume.'
                    : latestStatus.level === MIC_LEVEL.TOO_LOUD
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
                ? noiseResult === NOISE_FLOOR_LEVEL.NOISY
                  ? 'Some background noise -- consider a quieter room'
                  : latestStatus?.snr === SNR_LEVEL.FAIR
                    ? 'Signal quality is fair -- a quieter room would help'
                    : 'Your room sounds quiet'
                : checkState.environment === 'failed'
                  ? latestStatus?.snr === SNR_LEVEL.BLOCKING
                    ? 'Signal-to-noise ratio too low'
                    : 'Too much background noise'
                  : undefined
            }
            isLast
          >
            {checkState.environment === 'active' && (
              <p className="text-sm text-surface-400">Checking background noise and signal quality...</p>
            )}
            {checkState.environment === 'failed' && (
              <div className="space-y-2">
                <p className="text-sm text-danger-light">
                  {latestStatus?.snr === SNR_LEVEL.BLOCKING
                    ? 'Signal-to-noise ratio is too low for a quality recording. Reduce background noise or move closer to the microphone.'
                    : 'Please move to a quieter space. Background noise will affect recording quality.'}
                </p>
                {latestStatus?.spectralWarnings.includes(SPECTRAL_WARNING.HUM_DETECTED) && (
                  <p className="text-sm text-warning">
                    Electrical hum detected — try a different USB port or move away from power sources.
                  </p>
                )}
                <button
                  onClick={handleRetryEnvironment}
                  className="px-3 py-1.5 text-sm text-surface-50 rounded-md bg-surface-700 hover:bg-surface-600"
                >
                  Retry
                </button>
              </div>
            )}
            {/* Advisory spectral warnings (shown when passed but with issues) */}
            {checkState.environment === 'passed' && latestStatus && latestStatus.spectralWarnings.length > 0 && (
              <div className="mt-2 space-y-1">
                {latestStatus.spectralWarnings.includes(SPECTRAL_WARNING.MUFFLED) && (
                  <p className="text-xs text-warning">Audio sounds muffled — check that nothing is covering your microphone</p>
                )}
                {latestStatus.spectralWarnings.includes(SPECTRAL_WARNING.HUM_DETECTED) && (
                  <p className="text-xs text-warning">Electrical hum detected — try a different USB port</p>
                )}
                {latestStatus.stability === SIGNAL_STABILITY.UNSTABLE && (
                  <p className="text-xs text-warning">Signal is unstable — check your cable connection</p>
                )}
              </div>
            )}
          </StepItem>

          {/* Ready button */}
          <div className="pt-4 mt-2 border-t border-surface-700">
            <button
              onClick={handleReady}
              disabled={phase !== 'ready'}
              className={`w-full py-3 font-semibold rounded-lg transition-all ${
                phase === 'ready'
                  ? 'bg-accent-400 hover:bg-accent-500 text-surface-950 shadow-lg shadow-accent-400/20'
                  : 'bg-surface-700 text-surface-50 opacity-60 cursor-not-allowed'
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
    pending: 'bg-surface-700 text-surface-500',
    active: 'bg-accent-400 text-surface-950 ring-2 ring-accent-400/30',
    passed: 'bg-success text-surface-950',
    failed: 'bg-danger text-surface-50',
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
        <div className="absolute left-[15px] top-8 bottom-0 w-px bg-surface-700" />
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
            status === 'pending' ? 'text-surface-500' : 'text-surface-50'
          }`}
        >
          {label}
        </span>
        {statusText && (
          <span className="text-sm text-surface-400">&middot; {statusText}</span>
        )}
      </div>

      {/* Expandable content */}
      {isExpanded && children && <div className="mt-3">{children}</div>}
    </div>
  );
}
