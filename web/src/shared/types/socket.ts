import type { Meeting, Participant, RecordingState } from './meeting';
import type { QualityProfile } from '../constants/thresholds';

export interface SDPDescription {
  type: string;
  sdp?: string;
}

export interface ICECandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface JoinRoomPayload {
  roomId: string;
  role: 'host' | 'guest';
  userId: string;
  userEmail?: string;
}

export interface OfferPayload {
  target: string;
  sdp: SDPDescription;
}

export interface AnswerPayload {
  target: string;
  sdp: SDPDescription;
}

export interface IceCandidatePayload {
  target: string;
  candidate: ICECandidate;
}

export interface StartRecordingPayload {
  roomId: string;
}

export interface StopRecordingPayload {
  roomId: string;
}

export interface ChatMessagePayload {
  roomId: string;
  message: string;
  sender: string;
  role: 'host' | 'guest';
}

export interface MicCheckPayload {
  rms: number;
  peak: number;
  noiseFloor: number;
  isClipping: boolean;
}

export interface AudioMetricsPayload {
  timestamp: number;
  rms: number;
  peak: number;
  clipCount: number;
  silenceDuration: number;
  speechDetected: boolean;
}

export interface UploadProgressPayload {
  percent: number;
  participantName: string;
}

export interface RoomStatePayload {
  meeting: Meeting;
  participants: Participant[];
  recordingState: RecordingState;
}

export interface UserJoinedPayload {
  userId: string;
  persistentId: string;
  role: 'host' | 'guest';
  userEmail: string | null;
  isReconnection: boolean;
}

export interface UserLeftPayload {
  userId: string;
  persistentId: string;
  role: 'host' | 'guest';
}

export interface PeerReconnectedPayload {
  userId: string;
  newSocketId: string;
}

export interface RoomFullPayload {
  message: string;
}

export interface DuplicateSessionPayload {
  message: string;
}

export interface StartRecordingBroadcast {
  sessionId: string;
}

export interface ResumeRecordingPayload {
  startedAt: number;
  elapsedSeconds: number;
  sessionId: string;
}

export interface RecordingsUpdatedPayload {
  sessionId: string;
}

export interface MicStatusPayload {
  level: 'good' | 'too-quiet' | 'too-loud';
  noiseFloor: 'clean' | 'noisy' | 'unacceptable';
  clipping: boolean;
  suggestions: string[];
}

export interface RecordingWarningPayload {
  type: 'too-loud' | 'too-quiet' | 'clipping' | 'long-silence' | 'noise-increase' | 'overlap';
  speaker: string;
  message: string;
  severity: 'warning' | 'critical';
}

export interface QualityUpdatePayload {
  estimatedProfile: QualityProfile;
  metrics: {
    avgRms: number;
    clipCount: number;
    overlapPercent: number;
  };
}

export interface ProcessingStatusPayload {
  step: 'syncing' | 'validating' | 'classifying' | 'preprocessing' | 'complete';
  progress: number;
  estimatedTimeLeft: number;
}

export interface ProcessingCompletePayload {
  profile: QualityProfile;
  metrics: Record<string, number>;
  variants: {
    asr?: string;
    annotator?: string;
  };
  warnings: string[];
}

export interface RecordingRejectedPayload {
  reason: string;
  suggestions: string[];
}

export interface ChatMessageBroadcast {
  message: string;
  sender: string;
  role: 'host' | 'guest';
  timestamp: string;
}

export interface ErrorPayload {
  message: string;
}
