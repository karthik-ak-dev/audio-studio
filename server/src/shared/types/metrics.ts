import type { QualityProfile } from '../constants/thresholds';

export interface MicCheckMetrics {
  rms: number;
  peak: number;
  noiseFloor: number;
  isClipping: boolean;
}

export interface MicStatus {
  level: 'good' | 'too-quiet' | 'too-loud';
  noiseFloor: 'clean' | 'noisy' | 'unacceptable';
  clipping: boolean;
  suggestions: string[];
}

export interface AudioMetricsBatch {
  timestamp: number;
  rms: number;
  peak: number;
  clipCount: number;
  silenceDuration: number;
  speechDetected: boolean;
}

export interface SpeakerMetricsAggregate {
  totalBatches: number;
  avgRms: number;
  peakRms: number;
  totalClips: number;
  totalSilenceMs: number;
  speechRatio: number;
  lastBatchTimestamp: number;
}

export interface RoomMetricsAggregate {
  roomId: string;
  sessionId: string;
  speakers: Record<string, SpeakerMetricsAggregate>;
  overlapPercent: number;
  estimatedProfile: QualityProfile;
  startedAt: number;
}

export interface RecordingWarning {
  type: 'too-loud' | 'too-quiet' | 'clipping' | 'long-silence' | 'noise-increase' | 'overlap';
  speaker: string;
  message: string;
  severity: 'warning' | 'critical';
}
