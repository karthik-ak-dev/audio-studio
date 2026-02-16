/**
 * useSocket.ts — Socket.IO connection and event management hook.
 *
 * Central hub for all real-time communication with the server. Manages the
 * socket lifecycle and routes incoming events to the appropriate callbacks.
 *
 * ## Lifecycle
 *
 * 1. On mount, connects via `connectSocket()` (singleton from socketService)
 * 2. Registers listeners for all Socket.IO events
 * 3. Provides action methods: joinRoom, startRecording, stopRecording, sendChat
 * 4. On unmount, removes all listeners and disconnects
 *
 * ## Event Categories
 *
 * ### Room/Session Events
 * - `room-state` → Updates roomState (meeting, participants, recordingState)
 * - `user-joined` → Triggers WebRTC connection setup
 * - `user-left` → Triggers WebRTC teardown
 * - `peer-reconnected` → Triggers WebRTC reconnection (new socket ID)
 * - `room-full` → Room at capacity, redirect user
 * - `duplicate-session` → Same user in another tab
 *
 * ### Recording Events
 * - `start-recording` → Begin local AudioWorklet capture
 * - `stop-recording` → Stop capture, encode WAV, trigger upload
 * - `resume-recording` → Resume capture after reconnection
 *
 * ### WebRTC Signaling (relay only — server doesn't inspect payloads)
 * - `offer` → Incoming WebRTC offer from peer
 * - `answer` → Incoming answer from peer
 * - `ice-candidate` → Incoming ICE candidate from peer
 *
 * ### Quality Monitoring
 * - `recording-warning` → Quality issue detected by server
 * - `quality-update` → Aggregated quality profile estimate
 * - `mic-status` → Mic check result (GreenRoom)
 *
 * ### Chat
 * - `chat-message` → Text message from peer
 *
 * ## Callback Architecture
 *
 * Callbacks are passed in via the `callbacks` parameter and invoked directly
 * from Socket.IO event handlers. They are captured in the initial useEffect
 * closure, so they must be stable references or the hook should be re-mounted.
 * The eslint-disable on the dependency array is intentional — reconnecting
 * on every callback change would disrupt the socket connection.
 */

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

  /**
   * Main effect: connect socket and register all event listeners.
   *
   * Runs once on mount. The empty dependency array is intentional — we want
   * a single socket connection for the component's lifetime. Reconnecting
   * on every render would interrupt the WebRTC signaling flow.
   */
  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;

    // Connection state
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    // Room state — full snapshot sent after join-room
    socket.on(SOCKET_EVENTS.ROOM_STATE, (data: RoomStatePayload) => setRoomState(data));
    socket.on(SOCKET_EVENTS.ERROR, (data: ErrorPayload) => setError(data.message));

    // Session lifecycle events
    socket.on(SOCKET_EVENTS.USER_JOINED, (data: UserJoinedPayload) => callbacks?.onUserJoined?.(data));
    socket.on(SOCKET_EVENTS.USER_LEFT, (data: UserLeftPayload) => callbacks?.onUserLeft?.(data));
    socket.on(SOCKET_EVENTS.PEER_RECONNECTED, (data: PeerReconnectedPayload) => callbacks?.onPeerReconnected?.(data));
    socket.on(SOCKET_EVENTS.ROOM_FULL, () => callbacks?.onRoomFull?.());
    socket.on(SOCKET_EVENTS.DUPLICATE_SESSION, () => callbacks?.onDuplicateSession?.());

    // Recording lifecycle events
    socket.on(SOCKET_EVENTS.START_RECORDING, (data: StartRecordingBroadcast) => callbacks?.onStartRecording?.(data));
    socket.on(SOCKET_EVENTS.STOP_RECORDING, () => callbacks?.onStopRecording?.());
    socket.on(SOCKET_EVENTS.RESUME_RECORDING, (data: ResumeRecordingPayload) => callbacks?.onResumeRecording?.(data));

    // WebRTC signaling relay — server adds `sender` field when forwarding
    socket.on(SOCKET_EVENTS.OFFER, (data: any) => callbacks?.onOffer?.(data));
    socket.on(SOCKET_EVENTS.ANSWER, (data: any) => callbacks?.onAnswer?.(data));
    socket.on(SOCKET_EVENTS.ICE_CANDIDATE, (data: any) => callbacks?.onIceCandidate?.(data));

    // Quality monitoring events
    socket.on(SOCKET_EVENTS.RECORDING_WARNING, (data: RecordingWarningPayload) => callbacks?.onRecordingWarning?.(data));
    socket.on(SOCKET_EVENTS.QUALITY_UPDATE, (data: QualityUpdatePayload) => callbacks?.onQualityUpdate?.(data));
    socket.on(SOCKET_EVENTS.MIC_STATUS, (data: MicStatusPayload) => callbacks?.onMicStatus?.(data));

    // Chat relay
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, (data: any) => callbacks?.onChatMessage?.(data));

    return () => {
      socket.removeAllListeners();
      disconnectSocket();
      socketRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Join the room — emits `join-room` with the user's identity.
   * Server creates a DynamoDB Session, joins the Socket.IO room,
   * and responds with `room-state`.
   */
  const joinRoom = useCallback(() => {
    socketRef.current?.emit(SOCKET_EVENTS.JOIN_ROOM, {
      roomId: options.roomId,
      role: options.role,
      userId: options.userId,
      userEmail: options.userEmail,
    });
  }, [options]);

  /**
   * Request recording start — server generates sessionId and broadcasts
   * `start-recording { sessionId }` to all participants.
   */
  const startRecording = useCallback(() => {
    socketRef.current?.emit(SOCKET_EVENTS.START_RECORDING, { roomId: options.roomId });
  }, [options.roomId]);

  /**
   * Request recording stop — server broadcasts `stop-recording` to all,
   * updates meeting status back to 'active', decrements recording counter.
   */
  const stopRecording = useCallback(() => {
    socketRef.current?.emit(SOCKET_EVENTS.STOP_RECORDING, { roomId: options.roomId });
  }, [options.roomId]);

  /**
   * Send a chat message — server broadcasts to all room participants
   * with an added timestamp.
   */
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
