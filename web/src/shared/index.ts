/**
 * shared/index.ts — Barrel re-export for all shared types and constants.
 *
 * This module is the single import point for the shared layer:
 *   import { SOCKET_EVENTS, LIMITS, AUDIO_THRESHOLDS } from '../shared';
 *   import type { Meeting, JoinRoomPayload } from '../shared';
 *
 * ## Organization
 *
 * Constants (runtime values):
 *   - LIMITS — File size, rate limits, participant caps, expiry durations
 *   - AUDIO_THRESHOLDS — dBFS thresholds, quality profile SNR cutoffs
 *   - SOCKET_EVENTS — Event name strings for Socket.IO (type-safe via `as const`)
 *   - MEETING_STATUSES — Valid meeting lifecycle states
 *
 * Types (compile-time only):
 *   - meeting.ts — Meeting, Session, Recording, RecordingState, Participant
 *   - socket.ts — All Socket.IO event payload interfaces (30+ types)
 *   - upload.ts — REST API request/response shapes for S3 upload endpoints
 *   - metrics.ts — Audio analysis types (mic check, per-speaker, room-level)
 *   - processing.ts — SQS message and processing result shapes
 *
 * ## Shared Between Client and Server
 *
 * These types are designed to be shared between the web client and the
 * Node.js server. Both sides import from this barrel to ensure payload
 * shapes stay in sync. If a type is changed here, both sides see the
 * change at compile time.
 */

export { LIMITS } from './constants/limits';
export type { AllowedContentType } from './constants/limits';

export { AUDIO_THRESHOLDS } from './constants/thresholds';
export type { QualityProfile } from './constants/thresholds';

export { SOCKET_EVENTS } from './constants/events';
export type { SocketEvent } from './constants/events';

export type {
  Meeting,
  MeetingStatus,
  Session,
  Recording,
  RecordingState,
  Participant,
} from './types/meeting';
export { MEETING_STATUSES } from './types/meeting';

export type {
  SDPDescription,
  ICECandidate,
  JoinRoomPayload,
  OfferPayload,
  AnswerPayload,
  IceCandidatePayload,
  StartRecordingPayload,
  StopRecordingPayload,
  ChatMessagePayload,
  MicCheckPayload,
  AudioMetricsPayload,
  UploadProgressPayload,
  RoomStatePayload,
  UserJoinedPayload,
  UserLeftPayload,
  PeerReconnectedPayload,
  RoomFullPayload,
  DuplicateSessionPayload,
  StartRecordingBroadcast,
  ResumeRecordingPayload,
  RecordingsUpdatedPayload,
  MicStatusPayload,
  RecordingWarningPayload,
  QualityUpdatePayload,
  ProcessingStatusPayload,
  ProcessingCompletePayload,
  RecordingRejectedPayload,
  ChatMessageBroadcast,
  ErrorPayload,
} from './types/socket';

export type {
  GetUploadUrlRequest,
  GetUploadUrlResponse,
  UploadCompleteRequest,
  InitiateMultipartRequest,
  InitiateMultipartResponse,
  Part1Request,
  Part1Response,
  PartUrlRequest,
  PartUrlResponse,
  CompletePart,
  CompleteMultipartRequest,
  CompleteMultipartResponse,
  AbortMultipartRequest,
  ListPartsQuery,
  ListPartsResponse,
} from './types/upload';

export type {
  MicCheckMetrics,
  MicStatus,
  AudioMetricsBatch,
  SpeakerMetricsAggregate,
  RoomMetricsAggregate,
  RecordingWarning,
} from './types/metrics';

export type {
  ProcessSessionMessage,
  ProcessingResult,
} from './types/processing';
