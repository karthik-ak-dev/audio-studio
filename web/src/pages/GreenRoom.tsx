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
  const [deviceId, setDeviceId] = useState<string>('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micStatus, setMicStatus] = useState<{
    level: string;
    noiseFloor: string;
    suggestions: string[];
  } | null>(null);
  const [isReady, setIsReady] = useState(false);
  const { metrics, startMetrics, stopMetrics } = useAudioMetrics();
  const socketRef = useRef(connectSocket());

  // Get mic stream when device changes
  useEffect(() => {
    if (!deviceId) return;

    let currentStream: MediaStream | null = null;

    async function getMic() {
      // Stop previous stream
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

  // Send mic check metrics to server periodically
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

  // Listen for mic status from server
  useEffect(() => {
    const socket = socketRef.current;
    socket.on(SOCKET_EVENTS.MIC_STATUS, (data: any) => {
      setMicStatus(data);
    });
    return () => {
      socket.off(SOCKET_EVENTS.MIC_STATUS);
    };
  }, []);

  const handleReady = useCallback(() => {
    setIsReady(true);
    stopMetrics();
    stream?.getTracks().forEach((t) => t.stop());
    navigate(`/room/${roomId}`);
  }, [roomId, navigate, stopMetrics, stream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMetrics();
      stream?.getTracks().forEach((t) => t.stop());
      disconnectSocket();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const levelOk = micStatus?.level === 'good';
  const noiseOk = micStatus?.noiseFloor !== 'unacceptable';
  const canProceed = levelOk && noiseOk;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-1">Green Room</h1>
          <p className="text-gray-400">Test your microphone before recording</p>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-6">
          {/* Device selection */}
          <DeviceSelector onDeviceSelected={setDeviceId} selectedDeviceId={deviceId} />

          {/* Volume indicator */}
          {metrics && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">Input Level</label>
              <VolumeIndicator
                rmsDb={metrics.rms}
                peakDb={metrics.peak}
                isClipping={metrics.clipCount > 0}
              />
            </div>
          )}

          {/* Mic status feedback */}
          {micStatus && (
            <div className="space-y-2">
              <div className="flex gap-3">
                <StatusBadge label="Level" status={micStatus.level === 'good' ? 'good' : 'bad'} />
                <StatusBadge
                  label="Noise"
                  status={micStatus.noiseFloor === 'clean' ? 'good' : micStatus.noiseFloor === 'noisy' ? 'warn' : 'bad'}
                />
              </div>

              {micStatus.suggestions.length > 0 && (
                <ul className="text-sm text-gray-300 space-y-1">
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

          {/* Ready button */}
          <button
            onClick={handleReady}
            disabled={!canProceed && micStatus !== null}
            className="w-full bg-studio-600 hover:bg-studio-700 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50"
          >
            {!micStatus ? 'Checking microphone...' : canProceed ? "I'm Ready" : 'Fix issues before continuing'}
          </button>
        </div>
      </div>
    </div>
  );
}

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
