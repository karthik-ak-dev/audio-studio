import { useEffect, useRef, useCallback, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { connectSocket, disconnectSocket, getSocket } from '@/services/socketService';
import { SOCKET_EVENTS } from '../shared';
import type {
  RoomStatePayload,
  UserJoinedPayload,
  UserLeftPayload,
  PeerReconnectedPayload,
  StartRecordingBroadcast,
  ResumeRecordingPayload,
  RecordingWarningPayload,
  QualityUpdatePayload,
  MicStatusPayload,
  ErrorPayload,
} from '../shared';

export interface UseSocketOptions {
  roomId: string;
  role: 'host' | 'guest';
  userId: string;
  userEmail?: string;
}

export interface UseSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  roomState: RoomStatePayload | null;
  error: string | null;
  joinRoom: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  sendChat: (message: string) => void;
}

export function useSocket(
  options: UseSocketOptions,
  callbacks?: {
    onUserJoined?: (data: UserJoinedPayload) => void;
    onUserLeft?: (data: UserLeftPayload) => void;
    onPeerReconnected?: (data: PeerReconnectedPayload) => void;
    onStartRecording?: (data: StartRecordingBroadcast) => void;
    onStopRecording?: () => void;
    onResumeRecording?: (data: ResumeRecordingPayload) => void;
    onRecordingWarning?: (data: RecordingWarningPayload) => void;
    onQualityUpdate?: (data: QualityUpdatePayload) => void;
    onMicStatus?: (data: MicStatusPayload) => void;
    onOffer?: (data: { sdp: RTCSessionDescriptionInit; sender: string }) => void;
    onAnswer?: (data: { sdp: RTCSessionDescriptionInit; sender: string }) => void;
    onIceCandidate?: (data: { candidate: RTCIceCandidateInit; sender: string }) => void;
    onRoomFull?: () => void;
    onDuplicateSession?: () => void;
    onChatMessage?: (data: { message: string; sender: string; role: string; timestamp: string }) => void;
  },
): UseSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomStatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    // Room state
    socket.on(SOCKET_EVENTS.ROOM_STATE, (data: RoomStatePayload) => setRoomState(data));
    socket.on(SOCKET_EVENTS.ERROR, (data: ErrorPayload) => setError(data.message));

    // Session events
    socket.on(SOCKET_EVENTS.USER_JOINED, (data: UserJoinedPayload) => callbacks?.onUserJoined?.(data));
    socket.on(SOCKET_EVENTS.USER_LEFT, (data: UserLeftPayload) => callbacks?.onUserLeft?.(data));
    socket.on(SOCKET_EVENTS.PEER_RECONNECTED, (data: PeerReconnectedPayload) => callbacks?.onPeerReconnected?.(data));
    socket.on(SOCKET_EVENTS.ROOM_FULL, () => callbacks?.onRoomFull?.());
    socket.on(SOCKET_EVENTS.DUPLICATE_SESSION, () => callbacks?.onDuplicateSession?.());

    // Recording events
    socket.on(SOCKET_EVENTS.START_RECORDING, (data: StartRecordingBroadcast) => callbacks?.onStartRecording?.(data));
    socket.on(SOCKET_EVENTS.STOP_RECORDING, () => callbacks?.onStopRecording?.());
    socket.on(SOCKET_EVENTS.RESUME_RECORDING, (data: ResumeRecordingPayload) => callbacks?.onResumeRecording?.(data));

    // Signaling events
    socket.on(SOCKET_EVENTS.OFFER, (data: any) => callbacks?.onOffer?.(data));
    socket.on(SOCKET_EVENTS.ANSWER, (data: any) => callbacks?.onAnswer?.(data));
    socket.on(SOCKET_EVENTS.ICE_CANDIDATE, (data: any) => callbacks?.onIceCandidate?.(data));

    // Metrics events
    socket.on(SOCKET_EVENTS.RECORDING_WARNING, (data: RecordingWarningPayload) => callbacks?.onRecordingWarning?.(data));
    socket.on(SOCKET_EVENTS.QUALITY_UPDATE, (data: QualityUpdatePayload) => callbacks?.onQualityUpdate?.(data));
    socket.on(SOCKET_EVENTS.MIC_STATUS, (data: MicStatusPayload) => callbacks?.onMicStatus?.(data));

    // Chat
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, (data: any) => callbacks?.onChatMessage?.(data));

    return () => {
      socket.removeAllListeners();
      disconnectSocket();
      socketRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const joinRoom = useCallback(() => {
    socketRef.current?.emit(SOCKET_EVENTS.JOIN_ROOM, {
      roomId: options.roomId,
      role: options.role,
      userId: options.userId,
      userEmail: options.userEmail,
    });
  }, [options]);

  const startRecording = useCallback(() => {
    socketRef.current?.emit(SOCKET_EVENTS.START_RECORDING, { roomId: options.roomId });
  }, [options.roomId]);

  const stopRecording = useCallback(() => {
    socketRef.current?.emit(SOCKET_EVENTS.STOP_RECORDING, { roomId: options.roomId });
  }, [options.roomId]);

  const sendChat = useCallback(
    (message: string) => {
      socketRef.current?.emit(SOCKET_EVENTS.CHAT_MESSAGE, {
        roomId: options.roomId,
        message,
        sender: options.userId,
        role: options.role,
      });
    },
    [options],
  );

  return {
    socket: socketRef.current,
    isConnected,
    roomState,
    error,
    joinRoom,
    startRecording,
    stopRecording,
    sendChat,
  };
}
