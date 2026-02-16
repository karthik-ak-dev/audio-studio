/**
 * processing.ts — Types for the async audio processing pipeline.
 *
 * After both participants finish uploading their recordings, the server
 * publishes a ProcessSessionMessage to an SQS FIFO queue. An external
 * processing pipeline (not part of this server) consumes the message,
 * analyzes the audio, and publishes a ProcessingResult back to a
 * separate SQS results queue. The processingResultConsumer polls that
 * results queue and pushes notifications to connected clients via Socket.IO.
 *
 * Flow:
 *   1. Both recordings complete → pipelineService.triggerProcessingIfReady()
 *   2. Server publishes ProcessSessionMessage → SQS Processing Queue
 *   3. External pipeline processes audio files from S3
 *   4. External pipeline publishes ProcessingResult → SQS Results Queue
 *   5. processingResultConsumer polls Results Queue
 *   6. notificationService pushes result to clients via Socket.IO
 *
 * The FIFO queue uses roomId as the MessageGroupId (ensures in-order
 * processing per room) and `{roomId}:{sessionId}` as the deduplication ID
 * (prevents duplicate processing of the same session).
 */

import type { QualityProfile } from '../constants/thresholds';

/**
 * Message published to the SQS Processing Queue to trigger
 * the external audio processing pipeline.
 */
export interface ProcessSessionMessage {
  action: 'process-session';    // Fixed action identifier for the pipeline
  roomId: string;               // Meeting ID — used as SQS FIFO MessageGroupId
  sessionId: string;            // Recording session ID grouping host+guest files
  hostKey: string;              // S3 key of the host's recording file
  guestKey: string;             // S3 key of the guest's recording file
  timestamp: string;            // ISO 8601 timestamp when the message was created
}

/**
 * Result message received from the SQS Results Queue after
 * the external processing pipeline finishes analyzing the audio.
 */
export interface ProcessingResult {
  roomId: string;               // Meeting ID — used to route the notification
  sessionId: string;            // Recording session ID that was processed
  status: 'completed' | 'rejected'; // Whether the recording passed quality checks

  profile: QualityProfile;      // Final quality classification:
                                //   P0 = Studio quality (SNR >= 25dB)
                                //   P1 = Good quality (SNR >= 20dB)
                                //   P2 = Acceptable (SNR >= 15dB)
                                //   P3 = Poor but usable (SNR >= 10dB)
                                //   P4 = Rejected / unusable

  metrics: {
    snr: number;                // Signal-to-Noise Ratio (dB) — higher is better
    rms: number;                // Root Mean Square loudness (dBFS)
    srmr: number;               // Speech-to-Reverberation Modulation Ratio — measures room echo
    overlapPercent: number;     // % of time both speakers were talking simultaneously
    speakerBalance: number;     // Ratio of speaking time between participants (0-1, 0.5 = balanced)
    echoCorrelation: number;    // Cross-correlation detecting echo/feedback (0-1, lower = better)
    wvmos?: number;             // Optional: WVMOS (Wideband Voice MOS) quality score (1-5)
  };

  variants?: {                  // Output artifacts from the pipeline (optional)
    asr: string;                // S3 key for ASR (Automatic Speech Recognition) transcript
    annotator: string;          // S3 key for annotator-ready output
  };

  rejectionReason?: string;     // Human-readable reason if status === 'rejected'
  suggestions?: string[];       // Tips for improving quality on the next attempt
  processingTimeMs: number;     // How long the pipeline took to process (milliseconds)
}
