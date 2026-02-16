/**
 * webrtcService.ts — WebRTC peer connection factory and signaling helpers.
 *
 * Creates and manages RTCPeerConnection instances for live audio monitoring
 * between host and guest participants. The signaling (offer/answer/ICE) is
 * relayed through the server's Socket.IO — the server does NOT inspect or
 * modify WebRTC payloads, it simply forwards them to the target socket.
 *
 * ## Architecture
 *
 * This is SEPARATE from the recording pipeline:
 *   - WebRTC: Lossy, real-time audio for monitoring (Opus codec, variable bitrate)
 *   - Recorder: Lossless, local-only audio for the dataset (WAV, 48kHz 16-bit PCM)
 *
 * Both use the same MediaStream but serve different purposes.
 *
 * ## ICE Servers
 *
 * - **STUN** (always): Google public STUN servers for NAT traversal
 *   - stun:stun.l.google.com:19302
 *   - stun:stun1.l.google.com:19302
 *
 * - **TURN** (optional): For participants behind symmetric NATs/firewalls
 *   Configured via environment variables:
 *   - VITE_TURN_URL — e.g., "turn:turn.example.com:3478"
 *   - VITE_TURN_USERNAME — TURN auth username
 *   - VITE_TURN_CREDENTIAL — TURN auth password
 *
 * ## ICE Candidate Queuing
 *
 * A race condition exists in WebRTC signaling: ICE candidates may arrive
 * from the peer BEFORE the remote description is set. This causes
 * `addIceCandidate()` to fail with "InvalidStateError".
 *
 * Solution: Maintain a per-connection candidate queue (Map<RTCPeerConnection, queue>).
 * - If remote description is set → add candidate immediately
 * - If not set yet → queue the candidate
 * - After `setRemoteDescription()` → flush the queue
 *
 * ## Connection Lifecycle
 *
 * 1. createPeerConnection() — Factory: creates PC, adds tracks, sets up callbacks
 * 2. createOffer() / handleOffer() — SDP exchange
 * 3. handleAnswer() — Complete SDP negotiation
 * 4. handleIceCandidate() — Add/queue ICE candidates
 * 5. cleanupPeerConnection() — Remove from candidate queue map
 *
 * Note: The caller (useWebRTC hook) is responsible for calling `pc.close()`
 * after cleanup to release the connection's resources.
 *
 * ## Socket.IO Events Used
 *
 * Client → Server (relay to target):
 *   `offer` — { target: socketId, sdp: RTCSessionDescription }
 *   `answer` — { target: socketId, sdp: RTCSessionDescription }
 *   `ice-candidate` — { target: socketId, candidate: RTCIceCandidateInit }
 *
 * Server → Client (relayed, with added `sender` field):
 *   `offer` — { sdp, sender: socketId }
 *   `answer` — { sdp, sender: socketId }
 *   `ice-candidate` — { candidate, sender: socketId }
 */

import type { Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '../shared';

/**
 * Build the ICE server list from defaults + environment TURN config.
 */
function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // Optional TURN server for NAT traversal behind restrictive firewalls
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

/**
 * ICE candidate queue — buffers candidates until remote description is set.
 * Keyed by RTCPeerConnection instance to support connection replacement
 * (e.g., on peer reconnection).
 */
const candidateQueues = new Map<RTCPeerConnection, RTCIceCandidateInit[]>();

/**
 * Flush all queued ICE candidates for a connection.
 * Called after setRemoteDescription() succeeds.
 */
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
  /** Called when the remote peer's audio stream is available */
  onRemoteStream: (stream: MediaStream) => void;
  /** Called when the connection state changes (new/connecting/connected/failed/etc.) */
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
}

/**
 * Create a new RTCPeerConnection with local audio tracks and event handlers.
 *
 * Sets up:
 * - ICE candidate relay via Socket.IO
 * - Remote stream detection via ontrack
 * - Connection state change monitoring
 * - ICE candidate queue for this connection
 *
 * @param socket — Socket.IO client for signaling
 * @param targetSocketId — The peer's socket ID for targeting signaling messages
 * @param localStream — The user's mic MediaStream to add as local tracks
 * @param callbacks — Handlers for remote stream and connection state
 */
export function createPeerConnection(
  socket: Socket,
  targetSocketId: string,
  localStream: MediaStream,
  callbacks: WebRTCCallbacks,
): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: getIceServers() });

  // Initialize the candidate queue for this connection
  candidateQueues.set(pc, []);

  // Add local audio tracks to the connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Relay ICE candidates to peer via Socket.IO
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit(SOCKET_EVENTS.ICE_CANDIDATE, {
        target: targetSocketId,
        candidate: event.candidate.toJSON(),
      });
    }
  };

  // Capture the remote peer's audio stream
  pc.ontrack = (event) => {
    if (event.streams[0]) {
      callbacks.onRemoteStream(event.streams[0]);
    }
  };

  // Monitor connection state for UI indicators
  pc.onconnectionstatechange = () => {
    callbacks.onConnectionStateChange(pc.connectionState);
  };

  return pc;
}

/**
 * Create an SDP offer and send it to the peer via Socket.IO.
 * Called by the initiator (existing user when peer joins).
 */
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

/**
 * Handle an incoming SDP offer: set remote description, flush queued
 * candidates, create an answer, and send it back via Socket.IO.
 * Called by the responder (new user receiving the offer).
 */
export async function handleOffer(
  pc: RTCPeerConnection,
  sdp: RTCSessionDescriptionInit,
  socket: Socket,
  senderSocketId: string,
): Promise<void> {
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  await flushCandidateQueue(pc); // Process any candidates that arrived early
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit(SOCKET_EVENTS.ANSWER, {
    target: senderSocketId,
    sdp: pc.localDescription,
  });
}

/**
 * Handle an incoming SDP answer: set remote description and flush
 * any queued ICE candidates.
 */
export async function handleAnswer(
  pc: RTCPeerConnection,
  sdp: RTCSessionDescriptionInit,
): Promise<void> {
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  await flushCandidateQueue(pc);
}

/**
 * Handle an incoming ICE candidate.
 * If remote description is set → add immediately.
 * If not set yet → queue for later (flushed after setRemoteDescription).
 */
export async function handleIceCandidate(
  pc: RTCPeerConnection,
  candidate: RTCIceCandidateInit,
): Promise<void> {
  if (!pc.remoteDescription) {
    // Remote description not set yet — queue for later
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

/**
 * Clean up a peer connection's candidate queue.
 * Called before pc.close() to prevent memory leaks from the Map reference.
 */
export function cleanupPeerConnection(pc: RTCPeerConnection): void {
  candidateQueues.delete(pc);
}
