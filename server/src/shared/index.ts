/**
 * shared/index.ts — Barrel export for all shared types and constants.
 *
 * This module serves as the single import point for the shared layer.
 * Server code imports from here (e.g., `import { LIMITS, Meeting } from '../shared'`)
 * rather than reaching into individual files.
 *
 * The shared layer contains:
 *   - Constants: LIMITS, AUDIO_THRESHOLDS, SOCKET_EVENTS, MEETING_STATUSES
 *   - Domain Types: Meeting, Session, Recording, RecordingState, Participant
 *   - Socket Payload Types: all event payload interfaces
 *   - Upload Types: request/response interfaces for the upload REST API
 *   - Metrics Types: audio quality metric interfaces
 *   - Processing Types: SQS message interfaces for the processing pipeline
 */

export { LIMITS } from './constants/limits';
export type { AllowedContentType } from './constants/limits';

export { AUDIO_THRESHOLDS } from './constants/thresholds';
export type { QualityProfile } from './constants/thresholds';

export { SOCKET_EVENTS } from './constants/events';
export type { SocketEvent } from './constants/events';

export {
  ROLES, MEETING_STATUS, RECORDING_STATUS,
  MIC_LEVEL, NOISE_FLOOR_LEVEL, SNR_LEVEL, SIGNAL_STABILITY, SPECTRAL_WARNING,
  WARNING_TYPE, SEVERITY, QUALITY_PROFILE,
} from './constants/enums';
export type { Role } from './constants/enums';

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
  SpectralWarning,
  AudioMetricsBatch,
  SpeakerMetricsAggregate,
  RoomMetricsAggregate,
  RecordingWarning,
} from './types/metrics';

export type {
  ProcessSessionMessage,
  ProcessingResult,
} from './types/processing';
