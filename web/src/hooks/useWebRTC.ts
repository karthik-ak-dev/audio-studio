/**
 * useWebRTC.ts — WebRTC peer connection management hook.
 *
 * Manages the RTCPeerConnection lifecycle for live audio monitoring between
 * the host and guest. This is SEPARATE from the recording pipeline — WebRTC
 * provides real-time audio playback so participants can hear each other,
 * while recorderService captures lossless local audio for the dataset.
 *
 * ## Connection Flow
 *
 * ### Initiator (existing user when peer joins):
 * 1. `initConnection(socket, targetSocketId, localStream)`
 * 2. Creates RTCPeerConnection with ICE servers
 * 3. Adds local audio tracks
 * 4. Creates SDP offer → sends via Socket.IO `offer` event
 * 5. Receives answer → sets remote description
 * 6. ICE candidates exchanged until connection established
 *
 * ### Responder (newly joining user):
 * 1. Receives `offer` event → `handleIncomingOffer(socket, sdp, sender, localStream)`
 * 2. Creates RTCPeerConnection with ICE servers
 * 3. Sets remote description from offer
 * 4. Flushes any queued ICE candidates
 * 5. Creates SDP answer → sends via Socket.IO `answer` event
 * 6. ICE candidates exchanged until connection established
 *
 * ### Reconnection (peer refreshes page or network drops):
 * 1. Server emits `peer-reconnected` with new socket ID
 * 2. `closeConnection()` tears down old RTCPeerConnection
 * 3. `initConnection()` creates new one targeting the new socket ID
 * 4. New offer/answer exchange happens
 *
 * ## ICE Servers
 *
 * - STUN: Google public servers (stun.l.google.com, stun1.l.google.com)
 * - TURN: Optional, configured via VITE_TURN_URL/USERNAME/CREDENTIAL env vars
 *   TURN is needed when participants are behind symmetric NATs or firewalls.
 *
 * ## ICE Candidate Queuing
 *
 * ICE candidates may arrive before the remote description is set (race condition
 * in the signaling flow). The webrtcService queues these candidates and flushes
 * them after setRemoteDescription completes.
 *
 * ## State
 *
 * - `remoteStream` — The peer's audio MediaStream (attached to <audio> element)
 * - `connectionState` — RTCPeerConnectionState for UI indicators
 */

import { useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import {
  createPeerConnection,
  createOffer,
  handleOffer,
  handleAnswer,
  handleIceCandidate,
  cleanupPeerConnection,
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
  /** The remote peer's audio stream — null until WebRTC connection establishes */
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  /** Current connection state — tracks the RTCPeerConnection state machine */
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | null>(null);

  /** Ref to the active RTCPeerConnection — only one connection at a time */
  const pcRef = useRef<RTCPeerConnection | null>(null);

  /**
   * Initiate a WebRTC connection to a peer (we are the offerer).
   * Called when a new user joins the room.
   */
  const initConnection = useCallback(
    (socket: Socket, targetSocketId: string, localStream: MediaStream) => {
      // Clean up any existing connection first
      if (pcRef.current) {
        cleanupPeerConnection(pcRef.current);
        pcRef.current.close();
      }

      const pc = createPeerConnection(socket, targetSocketId, localStream, {
        onRemoteStream: setRemoteStream,
        onConnectionStateChange: setConnectionState,
      });
      pcRef.current = pc;

      // Create and send offer via Socket.IO signaling
      createOffer(pc, socket, targetSocketId);
    },
    [],
  );

  /**
   * Handle an incoming offer from a peer (we are the answerer).
   * Called when we receive an `offer` event via Socket.IO.
   */
  const handleIncomingOffer = useCallback(
    async (
      socket: Socket,
      sdp: RTCSessionDescriptionInit,
      senderSocketId: string,
      localStream: MediaStream,
    ) => {
      // Clean up any existing connection first
      if (pcRef.current) {
        cleanupPeerConnection(pcRef.current);
        pcRef.current.close();
      }

      const pc = createPeerConnection(socket, senderSocketId, localStream, {
        onRemoteStream: setRemoteStream,
        onConnectionStateChange: setConnectionState,
      });
      pcRef.current = pc;

      await handleOffer(pc, sdp, socket, senderSocketId);
    },
    [],
  );

  /** Set the remote answer on our PeerConnection */
  const handleIncomingAnswer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    if (pcRef.current) {
      await handleAnswer(pcRef.current, sdp);
    }
  }, []);

  /**
   * Add an ICE candidate from the peer.
   * If remote description isn't set yet, the candidate is queued
   * in webrtcService and flushed after setRemoteDescription.
   */
  const handleIncomingIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (pcRef.current) {
      await handleIceCandidate(pcRef.current, candidate);
    }
  }, []);

  /**
   * Close the WebRTC connection and clean up all resources.
   * Called on peer disconnect or before creating a new connection.
   */
  const closeConnection = useCallback(() => {
    if (pcRef.current) {
      cleanupPeerConnection(pcRef.current);
      pcRef.current.close();
    }
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
