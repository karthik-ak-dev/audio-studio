/**
 * enums.ts — Runtime constants for string enums used across the platform.
 *
 * These replace hardcoded string literals throughout the codebase. Each constant
 * object is typed `as const` so TypeScript infers literal types, and the existing
 * union types (e.g., MeetingStatus, MicStatus['level']) remain compatible.
 *
 * Usage:
 *   import { ROLES, MEETING_STATUS } from '../shared';
 *   if (socket.userRole !== ROLES.HOST) { ... }
 *   meetingService.updateStatus(roomId, MEETING_STATUS.RECORDING);
 */

// ─── Participant Roles ───────────────────────────────────────────
export const ROLES = {
  HOST: 'host',
  GUEST: 'guest',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// ─── Meeting Status ──────────────────────────────────────────────
export const MEETING_STATUS = {
  SCHEDULED: 'scheduled',
  ACTIVE: 'active',
  RECORDING: 'recording',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

// ─── Recording Upload Status ─────────────────────────────────────
export const RECORDING_STATUS = {
  UPLOADING: 'uploading',
  COMPLETED: 'completed',
} as const;

// ─── Mic Level (Green Room) ──────────────────────────────────────
export const MIC_LEVEL = {
  GOOD: 'good',
  TOO_QUIET: 'too-quiet',
  TOO_LOUD: 'too-loud',
} as const;

// ─── Noise Floor (Green Room) ────────────────────────────────────
export const NOISE_FLOOR_LEVEL = {
  CLEAN: 'clean',
  NOISY: 'noisy',
  UNACCEPTABLE: 'unacceptable',
} as const;

// ─── Signal-to-Noise Ratio (Green Room) ──────────────────────────
export const SNR_LEVEL = {
  GOOD: 'good',
  FAIR: 'fair',
  POOR: 'poor',
  BLOCKING: 'blocking',
} as const;

// ─── Signal Stability (Green Room) ──────────────────────────────
export const SIGNAL_STABILITY = {
  STABLE: 'stable',
  UNSTABLE: 'unstable',
} as const;

// ─── Spectral Warnings (Green Room) ─────────────────────────────
export const SPECTRAL_WARNING = {
  MUFFLED: 'muffled',
  HUM_DETECTED: 'hum-detected',
  NOISE_LIKE: 'noise-like',
} as const;

// ─── Recording Warning Types (Live Metrics) ─────────────────────
export const WARNING_TYPE = {
  CLIPPING: 'clipping',
  TOO_LOUD: 'too-loud',
  TOO_QUIET: 'too-quiet',
  LONG_SILENCE: 'long-silence',
  NOISE_INCREASE: 'noise-increase',
  OVERLAP: 'overlap',
} as const;

// ─── Warning Severity ───────────────────────────────────────────
export const SEVERITY = {
  WARNING: 'warning',
  CRITICAL: 'critical',
} as const;

// ─── Quality Profile (Live Metrics) ─────────────────────────────
export const QUALITY_PROFILE = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  P4: 'P4',
} as const;
