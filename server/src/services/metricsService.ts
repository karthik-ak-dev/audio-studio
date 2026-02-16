import { AUDIO_THRESHOLDS } from '../shared';
import type {
  AudioMetricsBatch,
  SpeakerMetricsAggregate,
  RoomMetricsAggregate,
  RecordingWarning,
  QualityProfile,
} from '../shared';

// In-memory store for live metrics (ephemeral, per-pod)
const roomMetrics = new Map<string, RoomMetricsAggregate>();

export function getOrCreateRoom(roomId: string, sessionId: string): RoomMetricsAggregate {
  const key = `${roomId}:${sessionId}`;
  let room = roomMetrics.get(key);
  if (!room) {
    room = {
      roomId,
      sessionId,
      speakers: {},
      overlapPercent: 0,
      estimatedProfile: 'P0',
      startedAt: Date.now(),
    };
    roomMetrics.set(key, room);
  }
  return room;
}

export function cleanupRoom(roomId: string, sessionId: string): void {
  roomMetrics.delete(`${roomId}:${sessionId}`);
}

export function ingestMetrics(
  roomId: string,
  sessionId: string,
  speaker: string,
  batch: AudioMetricsBatch,
): RecordingWarning[] {
  const room = getOrCreateRoom(roomId, sessionId);
  const warnings: RecordingWarning[] = [];

  // Get or create speaker aggregate
  if (!room.speakers[speaker]) {
    room.speakers[speaker] = {
      totalBatches: 0,
      avgRms: 0,
      peakRms: -Infinity,
      totalClips: 0,
      totalSilenceMs: 0,
      speechRatio: 0,
      lastBatchTimestamp: 0,
    };
  }

  const agg = room.speakers[speaker];
  agg.totalBatches++;

  // Running average for RMS
  agg.avgRms = agg.avgRms + (batch.rms - agg.avgRms) / agg.totalBatches;
  if (batch.peak > agg.peakRms) agg.peakRms = batch.peak;
  agg.totalClips += batch.clipCount;
  agg.totalSilenceMs += batch.silenceDuration;
  agg.speechRatio =
    agg.speechRatio + (((batch.speechDetected ? 1 : 0) - agg.speechRatio) / agg.totalBatches);
  agg.lastBatchTimestamp = batch.timestamp;

  // ─── Warning checks ─────────────────────────────────────────

  // Clipping warning
  if (batch.clipCount >= AUDIO_THRESHOLDS.CLIP_WARNING_COUNT) {
    warnings.push({
      type: 'clipping',
      speaker,
      message: `${speaker} audio is clipping (${batch.clipCount} clips detected)`,
      severity: batch.clipCount >= AUDIO_THRESHOLDS.CLIP_WARNING_COUNT * 2 ? 'critical' : 'warning',
    });
  }

  // Too loud
  if (batch.rms > AUDIO_THRESHOLDS.MIC_TOO_LOUD) {
    warnings.push({
      type: 'too-loud',
      speaker,
      message: `${speaker} volume is too high (${batch.rms.toFixed(1)} dBFS)`,
      severity: 'warning',
    });
  }

  // Too quiet
  if (batch.rms < AUDIO_THRESHOLDS.MIC_TOO_QUIET && batch.speechDetected) {
    warnings.push({
      type: 'too-quiet',
      speaker,
      message: `${speaker} volume is very low (${batch.rms.toFixed(1)} dBFS)`,
      severity: 'warning',
    });
  }

  // Long silence
  if (agg.totalSilenceMs >= AUDIO_THRESHOLDS.SILENCE_WARNING_MS) {
    warnings.push({
      type: 'long-silence',
      speaker,
      message: `${speaker} has been silent for ${Math.floor(agg.totalSilenceMs / 1000)}s`,
      severity: agg.totalSilenceMs >= AUDIO_THRESHOLDS.SILENCE_WARNING_MS * 2 ? 'critical' : 'warning',
    });
  }

  // Overlap check (both speakers speaking simultaneously)
  const speakerNames = Object.keys(room.speakers);
  if (speakerNames.length === 2) {
    const [s1, s2] = speakerNames;
    const r1 = room.speakers[s1].speechRatio;
    const r2 = room.speakers[s2].speechRatio;
    // Rough overlap estimate: min of both speech ratios × 100
    const overlap = Math.min(r1, r2) * 100;
    room.overlapPercent = overlap;

    if (overlap > AUDIO_THRESHOLDS.OVERLAP_WARNING_PCT) {
      warnings.push({
        type: 'overlap',
        speaker: 'both',
        message: `Speakers are overlapping ${overlap.toFixed(0)}% of the time`,
        severity: 'warning',
      });
    }
  }

  // Update estimated quality profile
  room.estimatedProfile = estimateProfile(room);

  return warnings;
}

export function getQualityUpdate(roomId: string, sessionId: string) {
  const room = getOrCreateRoom(roomId, sessionId);
  const allSpeakers = Object.values(room.speakers);
  const totalClips = allSpeakers.reduce((sum, s) => sum + s.totalClips, 0);
  const avgRms = allSpeakers.length > 0
    ? allSpeakers.reduce((sum, s) => sum + s.avgRms, 0) / allSpeakers.length
    : 0;

  return {
    estimatedProfile: room.estimatedProfile,
    metrics: {
      avgRms,
      clipCount: totalClips,
      overlapPercent: room.overlapPercent,
    },
  };
}

function estimateProfile(room: RoomMetricsAggregate): QualityProfile {
  const speakers = Object.values(room.speakers);
  if (speakers.length === 0) return 'P0';

  const avgRms = speakers.reduce((sum, s) => sum + s.avgRms, 0) / speakers.length;
  const totalClips = speakers.reduce((sum, s) => sum + s.totalClips, 0);
  const maxSilence = Math.max(...speakers.map((s) => s.totalSilenceMs));

  // Rough estimation — real profile is computed by the processing pipeline
  if (
    avgRms >= AUDIO_THRESHOLDS.TARGET_RMS_MIN &&
    avgRms <= AUDIO_THRESHOLDS.TARGET_RMS_MAX &&
    totalClips === 0 &&
    room.overlapPercent < 5 &&
    maxSilence < AUDIO_THRESHOLDS.SILENCE_WARNING_MS
  ) {
    return 'P0';
  }

  if (totalClips <= 5 && room.overlapPercent < 10) return 'P1';
  if (totalClips <= 20 && room.overlapPercent < 20) return 'P2';
  if (totalClips <= 50) return 'P3';
  return 'P4';
}
