/**
 * socket/signaling.ts — WebRTC signaling relay.
 *
 * WebRTC requires a signaling server to exchange session descriptions (SDP)
 * and ICE candidates between peers before a direct peer-to-peer audio
 * connection can be established. This module acts as that relay.
 *
 * The server does NOT process or inspect the WebRTC payloads — it simply
 * forwards them from the sender to the target socket by ID. The actual
 * audio stream flows directly between the two browsers via WebRTC.
 *
 * Three events are relayed:
 *   - OFFER:         Caller sends SDP offer → callee receives it
 *   - ANSWER:        Callee sends SDP answer → caller receives it
 *   - ICE_CANDIDATE: Either peer sends ICE candidate → other peer receives it
 *
 * Each event carries:
 *   - target:    Socket ID of the intended recipient
 *   - sdp/candidate: The WebRTC payload to relay
 *   - sender:    Socket ID of the sender (added by the server for attribution)
 *
 * Connection flow:
 *   Peer A (caller)                  Server                  Peer B (callee)
 *   ─────────────                    ──────                  ─────────────
 *   OFFER {target: B, sdp} ──────→  relay  ──────→  OFFER {sdp, sender: A}
 *                                                     ANSWER {target: A, sdp}
 *   ANSWER {sdp, sender: B} ←─────  relay  ←──────
 *   ICE_CANDIDATE ──────────────→   relay  ──────→  ICE_CANDIDATE
 *   ICE_CANDIDATE ←────────────── relay  ←──────  ICE_CANDIDATE
 *                    (audio flows directly via WebRTC after ICE completes)
 */
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../shared';
import { logger } from '../utils/logger';

export function handleSignaling(io: SocketIOServer, socket: Socket): void {
  // ─── SDP Offer Relay ─────────────────────────────────────────
  // The caller creates an offer with their media capabilities and
  // sends it to the callee via the server.
  socket.on(SOCKET_EVENTS.OFFER, (data) => {
    try {
      if (!data?.target || !data?.sdp) return;
      io.to(data.target).emit(SOCKET_EVENTS.OFFER, { sdp: data.sdp, sender: socket.id });
    } catch (err) {
      logger.error('Error handling offer', { socketId: socket.id, error: (err as Error).message });
    }
  });

  // ─── SDP Answer Relay ────────────────────────────────────────
  // The callee responds with their media capabilities, completing
  // the SDP negotiation.
  socket.on(SOCKET_EVENTS.ANSWER, (data) => {
    try {
      if (!data?.target || !data?.sdp) return;
      io.to(data.target).emit(SOCKET_EVENTS.ANSWER, { sdp: data.sdp, sender: socket.id });
    } catch (err) {
      logger.error('Error handling answer', { socketId: socket.id, error: (err as Error).message });
    }
  });

  // ─── ICE Candidate Relay ─────────────────────────────────────
  // ICE (Interactive Connectivity Establishment) candidates describe
  // network paths the peers can use to connect. Multiple candidates
  // are exchanged as the browser discovers available routes (local,
  // STUN-reflexive, TURN-relayed).
  socket.on(SOCKET_EVENTS.ICE_CANDIDATE, (data) => {
    try {
      if (!data?.target || !data?.candidate) return;
      io.to(data.target).emit(SOCKET_EVENTS.ICE_CANDIDATE, {
        candidate: data.candidate,
        sender: socket.id,
      });
    } catch (err) {
      logger.error('Error handling ICE candidate', {
        socketId: socket.id,
        error: (err as Error).message,
      });
    }
  });
}
