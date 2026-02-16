import type { Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '../shared';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export interface WebRTCCallbacks {
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
}

export function createPeerConnection(
  socket: Socket,
  targetSocketId: string,
  localStream: MediaStream,
  callbacks: WebRTCCallbacks,
): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // Add local tracks
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit(SOCKET_EVENTS.ICE_CANDIDATE, {
        target: targetSocketId,
        candidate: event.candidate.toJSON(),
      });
    }
  };

  // Remote stream
  pc.ontrack = (event) => {
    if (event.streams[0]) {
      callbacks.onRemoteStream(event.streams[0]);
    }
  };

  // Connection state
  pc.onconnectionstatechange = () => {
    callbacks.onConnectionStateChange(pc.connectionState);
  };

  return pc;
}

export async function createOffer(
  pc: RTCPeerConnection,
  socket: Socket,
  targetSocketId: string,
): Promise<void> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit(SOCKET_EVENTS.OFFER, {
    target: targetSocketId,
    sdp: pc.localDescription,
  });
}

export async function handleOffer(
  pc: RTCPeerConnection,
  sdp: RTCSessionDescriptionInit,
  socket: Socket,
  senderSocketId: string,
): Promise<void> {
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit(SOCKET_EVENTS.ANSWER, {
    target: senderSocketId,
    sdp: pc.localDescription,
  });
}

export async function handleAnswer(
  pc: RTCPeerConnection,
  sdp: RTCSessionDescriptionInit,
): Promise<void> {
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

export async function handleIceCandidate(
  pc: RTCPeerConnection,
  candidate: RTCIceCandidateInit,
): Promise<void> {
  await pc.addIceCandidate(new RTCIceCandidate(candidate));
}
