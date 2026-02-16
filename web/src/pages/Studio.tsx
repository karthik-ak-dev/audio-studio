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

export default function Studio() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [warnings, setWarnings] = useState<RecordingWarningPayload[]>([]);
  const [qualityUpdate, setQualityUpdate] = useState<QualityUpdatePayload | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // Generate a persistent userId
  const userId = useRef(localStorage.getItem('userId') || `user_${crypto.randomUUID()}`);
  useEffect(() => {
    localStorage.setItem('userId', userId.current);
  }, []);

  const { metrics, startMetrics, stopMetrics } = useAudioMetrics();
  const recorder = useRecorder();
  const upload = useUpload();
  const webrtc = useWebRTC();

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
      role: 'host', // Will be corrected by server based on join order
      userId: userId.current,
    },
    {
      onUserJoined: (data) => {
        if (!data.isReconnection && localStream && socket) {
          webrtc.initConnection(socket, data.userId, localStream);
        }
      },
      onUserLeft: () => {
        webrtc.closeConnection();
      },
      onPeerReconnected: (data) => {
        if (localStream && socket) {
          webrtc.closeConnection();
          webrtc.initConnection(socket, data.newSocketId, localStream);
        }
      },
      onStartRecording: async (data) => {
        setSessionId(data.sessionId);
        setWarnings([]);
        if (localStream) {
          await recorder.start(localStream);
        }
      },
      onStopRecording: async () => {
        const blob = recorder.stop();
        if (blob && roomId) {
          await upload.upload(blob, roomId, userId.current, sessionId || undefined);
        }
        setSessionId(null);
      },
      onResumeRecording: async (data) => {
        setSessionId(data.sessionId);
        if (localStream && !recorder.isRecording) {
          await recorder.start(localStream);
        }
      },
      onRecordingWarning: (data) => {
        setWarnings((prev) => [...prev.slice(-4), data]); // Keep last 5
      },
      onQualityUpdate: (data) => {
        setQualityUpdate(data);
      },
      onOffer: async (data) => {
        if (localStream && socket) {
          await webrtc.handleIncomingOffer(socket, data.sdp, data.sender, localStream);
        }
      },
      onAnswer: async (data) => {
        await webrtc.handleIncomingAnswer(data.sdp);
      },
      onIceCandidate: async (data) => {
        await webrtc.handleIncomingIceCandidate(data.candidate);
      },
      onRoomFull: () => {
        navigate('/');
      },
      onChatMessage: (data) => {
        setChatMessages((prev) => [...prev, data]);
      },
    },
  );

  // Get local mic stream
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

  // Join room once connected and stream ready
  useEffect(() => {
    if (isConnected && localStream) {
      joinRoom();
    }
  }, [isConnected, localStream, joinRoom]);

  // Play remote audio
  useEffect(() => {
    if (webrtc.remoteStream && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = webrtc.remoteStream;
    }
  }, [webrtc.remoteStream]);

  // Send live audio metrics to server during recording
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

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const participants = roomState?.participants || [];
  const peerConnected = participants.length > 1;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">
            {roomState?.meeting?.title || 'Audio Studio'}
          </h1>
          <p className="text-xs text-gray-500">Room: {roomId}</p>
        </div>
        <div className="flex items-center gap-4">
          {qualityUpdate && <QualityBadge profile={qualityUpdate.estimatedProfile} />}
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
        </div>
      </header>

      {error && (
        <div className="bg-red-900/50 border-b border-red-500 px-6 py-2 text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex">
        {/* Left panel — recording controls + metrics */}
        <div className="flex-1 p-6 space-y-6">
          {/* Participants */}
          <div className="flex gap-4">
            {participants.map((p) => (
              <div key={p.socketId} className="bg-gray-900 rounded-lg border border-gray-800 px-4 py-3 flex-1">
                <div className="text-sm text-gray-400 mb-1">{p.role}</div>
                <div className="text-white font-medium">{p.userEmail || p.userId}</div>
              </div>
            ))}
            {participants.length < 2 && (
              <div className="bg-gray-900 rounded-lg border border-gray-800 border-dashed px-4 py-3 flex-1 flex items-center justify-center text-gray-600 text-sm">
                Waiting for partner...
              </div>
            )}
          </div>

          {/* Audio levels */}
          {metrics && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">Your Audio Level</label>
              <VolumeIndicator
                rmsDb={metrics.rms}
                peakDb={metrics.peak}
                isClipping={metrics.clipCount > 0}
              />
            </div>
          )}

          {/* Recording controls */}
          <div className="flex items-center gap-4">
            {recorder.isRecording ? (
              <>
                <button
                  onClick={emitStopRecording}
                  className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
                >
                  Stop Recording
                </button>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-white font-mono text-lg">
                    {formatDuration(recorder.recordingDuration)}
                  </span>
                </div>
              </>
            ) : (
              <button
                onClick={emitStartRecording}
                disabled={!peerConnected}
                className="px-6 py-3 bg-studio-600 hover:bg-studio-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {peerConnected ? 'Start Recording' : 'Waiting for partner...'}
              </button>
            )}
          </div>

          {/* Warnings */}
          <WarningBanner warnings={warnings} />

          {/* Upload progress */}
          <UploadProgress
            progress={upload.progress}
            isUploading={upload.isUploading}
            error={upload.uploadError}
          />
        </div>

        {/* Right panel — chat */}
        <div className="w-80 border-l border-gray-800 p-4">
          <ChatPanel
            messages={chatMessages}
            onSend={sendChat}
            currentUserId={userId.current}
          />
        </div>
      </div>

      {/* Hidden audio elements */}
      <audio ref={remoteAudioRef} autoPlay />
    </div>
  );
}
