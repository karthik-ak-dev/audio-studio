import { useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import {
  createPeerConnection,
  createOffer,
  handleOffer,
  handleAnswer,
  handleIceCandidate,
} from '@/services/webrtcService';

export interface UseWebRTCReturn {
  remoteStream: MediaStream | null;
  connectionState: RTCPeerConnectionState | null;
  initConnection: (socket: Socket, targetSocketId: string, localStream: MediaStream) => void;
  handleIncomingOffer: (socket: Socket, sdp: RTCSessionDescriptionInit, senderSocketId: string, localStream: MediaStream) => Promise<void>;
  handleIncomingAnswer: (sdp: RTCSessionDescriptionInit) => Promise<void>;
  handleIncomingIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>;
  closeConnection: () => void;
}

export function useWebRTC(): UseWebRTCReturn {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const initConnection = useCallback(
    (socket: Socket, targetSocketId: string, localStream: MediaStream) => {
      // Close any existing connection
      pcRef.current?.close();

      const pc = createPeerConnection(socket, targetSocketId, localStream, {
        onRemoteStream: setRemoteStream,
        onConnectionStateChange: setConnectionState,
      });
      pcRef.current = pc;

      // Create and send offer
      createOffer(pc, socket, targetSocketId);
    },
    [],
  );

  const handleIncomingOffer = useCallback(
    async (
      socket: Socket,
      sdp: RTCSessionDescriptionInit,
      senderSocketId: string,
      localStream: MediaStream,
    ) => {
      // Close any existing connection
      pcRef.current?.close();

      const pc = createPeerConnection(socket, senderSocketId, localStream, {
        onRemoteStream: setRemoteStream,
        onConnectionStateChange: setConnectionState,
      });
      pcRef.current = pc;

      await handleOffer(pc, sdp, socket, senderSocketId);
    },
    [],
  );

  const handleIncomingAnswer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    if (pcRef.current) {
      await handleAnswer(pcRef.current, sdp);
    }
  }, []);

  const handleIncomingIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (pcRef.current) {
      await handleIceCandidate(pcRef.current, candidate);
    }
  }, []);

  const closeConnection = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    setRemoteStream(null);
    setConnectionState(null);
  }, []);

  return {
    remoteStream,
    connectionState,
    initConnection,
    handleIncomingOffer,
    handleIncomingAnswer,
    handleIncomingIceCandidate,
    closeConnection,
  };
}
