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
import { connectSocket, disconnectSocket } from '@/services/socketService';
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

  // Guard: prevent joinRoom from being called more than once.
  // Without this, re-renders cause joinRoom's useCallback to get a new reference
  // (because `options` is a new object each render), which triggers the useEffect
  // in Studio.tsx that depends on [joinRoom], causing multiple join-room emissions.
  const hasJoinedRef = useRef(false);

  // Keep a ref to callbacks so socket listeners always invoke the latest version.
  // Without this, the useEffect closure captures stale values from the first render
  // (e.g. localStream=null, socket=null) and events like USER_JOINED would never
  // trigger WebRTC because the closure check `localStream && socket` fails.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  /**
   * Main effect: connect socket and register all event listeners.
   *
   * Runs once on mount. The empty dependency array is intentional — we want
   * a single socket connection for the component's lifetime. Reconnecting
   * on every render would interrupt the WebRTC signaling flow.
   *
   * All callbacks go through callbacksRef so they always see current state.
   */
  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;

    // Connection state — check immediately in case socket was already connected
    // (e.g. reused from GreenRoom via the singleton)
    if (socket.connected) {
      setIsConnected(true);
    }
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    // Room state — full snapshot sent after join-room
    socket.on(SOCKET_EVENTS.ROOM_STATE, (data: RoomStatePayload) => setRoomState(data));
    socket.on(SOCKET_EVENTS.ERROR, (data: ErrorPayload) => setError(data.message));

    // Session lifecycle events — all go through callbacksRef for latest closure
    socket.on(SOCKET_EVENTS.USER_JOINED, (data: UserJoinedPayload) => {
      // Add the new participant to roomState so the UI updates immediately
      setRoomState((prev) => {
        if (!prev) return prev;
        const already = prev.participants.some((p) => p.userId === data.persistentId);
        if (already) return prev;
        return {
          ...prev,
          participants: [
            ...prev.participants,
            { socketId: data.userId, userId: data.persistentId, role: data.role, userEmail: data.userEmail },
          ],
        };
      });
      callbacksRef.current?.onUserJoined?.(data);
    });
    socket.on(SOCKET_EVENTS.USER_LEFT, (data: UserLeftPayload) => {
      // Remove the participant from roomState
      setRoomState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          participants: prev.participants.filter((p) => p.userId !== data.persistentId),
        };
      });
      callbacksRef.current?.onUserLeft?.(data);
    });
    socket.on(SOCKET_EVENTS.PEER_RECONNECTED, (data: PeerReconnectedPayload) => callbacksRef.current?.onPeerReconnected?.(data));
    socket.on(SOCKET_EVENTS.ROOM_FULL, () => {
      // Disable auto-reconnection BEFORE the server force-disconnects us.
      // Without this: server emits room-full → disconnects socket → Socket.IO
      // auto-reconnects → client re-emits join-room → room-full again → infinite loop
      // that creates dozens of DynamoDB session rows per second.
      socket.io.opts.reconnection = false;
      callbacksRef.current?.onRoomFull?.();
    });
    socket.on(SOCKET_EVENTS.DUPLICATE_SESSION, () => {
      socket.io.opts.reconnection = false;
      callbacksRef.current?.onDuplicateSession?.();
    });

    // Recording lifecycle events
    socket.on(SOCKET_EVENTS.START_RECORDING, (data: StartRecordingBroadcast) => callbacksRef.current?.onStartRecording?.(data));
    socket.on(SOCKET_EVENTS.STOP_RECORDING, () => callbacksRef.current?.onStopRecording?.());
    socket.on(SOCKET_EVENTS.RESUME_RECORDING, (data: ResumeRecordingPayload) => callbacksRef.current?.onResumeRecording?.(data));

    // WebRTC signaling relay — server adds `sender` field when forwarding
    socket.on(SOCKET_EVENTS.OFFER, (data: any) => callbacksRef.current?.onOffer?.(data));
    socket.on(SOCKET_EVENTS.ANSWER, (data: any) => callbacksRef.current?.onAnswer?.(data));
    socket.on(SOCKET_EVENTS.ICE_CANDIDATE, (data: any) => callbacksRef.current?.onIceCandidate?.(data));

    // Quality monitoring events
    socket.on(SOCKET_EVENTS.RECORDING_WARNING, (data: RecordingWarningPayload) => callbacksRef.current?.onRecordingWarning?.(data));
    socket.on(SOCKET_EVENTS.QUALITY_UPDATE, (data: QualityUpdatePayload) => callbacksRef.current?.onQualityUpdate?.(data));
    socket.on(SOCKET_EVENTS.MIC_STATUS, (data: MicStatusPayload) => callbacksRef.current?.onMicStatus?.(data));

    // Chat relay
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, (data: any) => callbacksRef.current?.onChatMessage?.(data));

    return () => {
      socket.removeAllListeners();
      // Restore reconnection setting in case it was disabled by room-full/duplicate-session
      socket.io.opts.reconnection = true;
      hasJoinedRef.current = false;
      disconnectSocket();
      socketRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Store options in a ref so joinRoom callback is stable (no new reference on re-render).
  // This prevents the useEffect in Studio.tsx [isConnected, localStream, joinRoom] from
  // re-firing joinRoom on every render when `options` is a new object literal.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /**
   * Join the room — emits `join-room` with the user's identity.
   * Guarded: only emits once per mount. The server's duplicate-join guard
   * is a safety net, but we should never hit it — this ref prevents the
   * client from flooding the server with concurrent join-room events.
   */
  const joinRoom = useCallback(() => {
    if (hasJoinedRef.current) return;
    hasJoinedRef.current = true;
    socketRef.current?.emit(SOCKET_EVENTS.JOIN_ROOM, {
      roomId: optionsRef.current.roomId,
      role: optionsRef.current.role,
      userId: optionsRef.current.userId,
      userEmail: optionsRef.current.userEmail,
    });
  }, []);

  /**
   * Request recording start — server generates sessionId and broadcasts
   * `start-recording { sessionId }` to all participants.
   */
  const startRecording = useCallback(() => {
    socketRef.current?.emit(SOCKET_EVENTS.START_RECORDING, { roomId: optionsRef.current.roomId });
  }, []);

  /**
   * Request recording stop — server broadcasts `stop-recording` to all,
   * updates meeting status back to 'active', decrements recording counter.
   */
  const stopRecording = useCallback(() => {
    socketRef.current?.emit(SOCKET_EVENTS.STOP_RECORDING, { roomId: optionsRef.current.roomId });
  }, []);

  /**
   * Send a chat message — server broadcasts to all room participants
   * with an added timestamp.
   */
  const sendChat = useCallback(
    (message: string) => {
      socketRef.current?.emit(SOCKET_EVENTS.CHAT_MESSAGE, {
        roomId: optionsRef.current.roomId,
        message,
        sender: optionsRef.current.userId,
        role: optionsRef.current.role,
      });
    },
    [],
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
