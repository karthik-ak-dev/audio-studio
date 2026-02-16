import type { Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '../shared';

function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
}

// ICE candidate queue — buffers candidates until remote description is set
const candidateQueues = new Map<RTCPeerConnection, RTCIceCandidateInit[]>();

async function flushCandidateQueue(pc: RTCPeerConnection): Promise<void> {
  const queue = candidateQueues.get(pc);
  if (!queue) return;
  while (queue.length > 0) {
    const candidate = queue.shift()!;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('Failed to add queued ICE candidate:', err);
    }
  }
}

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
  const pc = new RTCPeerConnection({ iceServers: getIceServers() });

  // Initialize candidate queue for this connection
  candidateQueues.set(pc, []);

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
  await flushCandidateQueue(pc);
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
  await flushCandidateQueue(pc);
}

export async function handleIceCandidate(
  pc: RTCPeerConnection,
  candidate: RTCIceCandidateInit,
): Promise<void> {
  if (!pc.remoteDescription) {
    const queue = candidateQueues.get(pc);
    if (queue) {
      queue.push(candidate);
    }
    return;
  }
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.warn('Failed to add ICE candidate:', err);
  }
}

export function cleanupPeerConnection(pc: RTCPeerConnection): void {
  candidateQueues.delete(pc);
}
