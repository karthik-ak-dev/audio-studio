/**
 * types/processing.ts — SQS message and processing pipeline result types.
 *
 * After both host and guest recordings are uploaded, the server publishes a
 * `ProcessSessionMessage` to SQS. A worker consumes this message, processes
 * the audio pair (sync, validate, classify, preprocess), and publishes the
 * result back to the room via Socket.IO events.
 *
 * ## Processing Pipeline
 *
 * 1. **Trigger**: `triggerProcessingIfReady()` on server detects both recordings
 *    are uploaded for a session → publishes to SQS
 *
 * 2. **SQS Message**: Contains S3 keys for both recordings + room/session IDs
 *
 * 3. **Worker Steps** (emitted as processing-status events):
 *    - syncing — Align host and guest audio tracks
 *    - validating — Check audio integrity (sample rate, bit depth, duration)
 *    - classifying — Compute quality metrics (SNR, RMS, SRMR, echo, overlap)
 *    - preprocessing — Generate output variants (ASR transcript, annotator ref)
 *    - complete — All steps finished
 *
 * 4. **Result**: Either processing-complete (with profile + metrics + variants)
 *    or recording-rejected (with reason + suggestions)
 *
 * ## Quality Metrics in ProcessingResult
 *
 * - snr: Signal-to-Noise Ratio (dB) — primary quality indicator
 * - rms: Root-mean-square level (dBFS) — average loudness
 * - srmr: Speech-to-Reverberation Modulation Ratio — room acoustics quality
 * - overlapPercent: % of simultaneous speech — dataset usability factor
 * - speakerBalance: Ratio of speaker durations — ideally close to 1.0
 * - echoCorrelation: Cross-correlation of channels — echo/crosstalk detection
 * - wvmos: (optional) WVMOS perceptual quality score
 */

import type { QualityProfile } from '../constants/thresholds';

/**
 * SQS message payload — published by server when both recordings are uploaded.
 * The processing worker reads this to know which files to process.
 */
export interface ProcessSessionMessage {
  action: 'process-session';    // Message type discriminator
  roomId: string;
  sessionId: string;            // Recording session ID
  hostKey: string;              // S3 object key for host's WAV recording
  guestKey: string;             // S3 object key for guest's WAV recording
  timestamp: string;            // ISO 8601 — when processing was triggered
}

/**
 * Processing result — the final output of the processing pipeline.
 *
 * Published back to the room via Socket.IO:
 *   - status 'completed' → processing-complete event
 *   - status 'rejected' → recording-rejected event
 */
export interface ProcessingResult {
  roomId: string;
  sessionId: string;
  status: 'completed' | 'rejected';
  profile: QualityProfile;      // Final quality tier (P0–P4)
  metrics: {
    snr: number;                // Signal-to-Noise Ratio (dB)
    rms: number;                // Average RMS level (dBFS)
    srmr: number;               // Speech-to-Reverberation Modulation Ratio
    overlapPercent: number;     // % simultaneous speech
    speakerBalance: number;     // Ratio of speaker durations
    echoCorrelation: number;    // Cross-channel echo detection (0–1)
    wvmos?: number;             // Optional: WVMOS perceptual quality score
  };
  variants?: {
    asr: string;                // S3 key for ASR transcript output
    annotator: string;          // S3 key for annotator reference output
  };
  rejectionReason?: string;     // Set when status === 'rejected'
  suggestions?: string[];       // Improvement tips (set on rejection)
  processingTimeMs: number;     // Wall-clock processing duration
}
