import type { QualityProfile } from '../constants/thresholds';

export interface ProcessSessionMessage {
  action: 'process-session';
  roomId: string;
  sessionId: string;
  hostKey: string;
  guestKey: string;
  timestamp: string;
}

export interface ProcessingResult {
  roomId: string;
  sessionId: string;
  status: 'completed' | 'rejected';
  profile: QualityProfile;
  metrics: {
    snr: number;
    rms: number;
    srmr: number;
    overlapPercent: number;
    speakerBalance: number;
    echoCorrelation: number;
    wvmos?: number;
  };
  variants?: {
    asr: string;
    annotator: string;
  };
  rejectionReason?: string;
  suggestions?: string[];
  processingTimeMs: number;
}
