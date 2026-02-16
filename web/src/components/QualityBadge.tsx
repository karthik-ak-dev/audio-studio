/**
 * QualityBadge.tsx — Color-coded quality profile indicator.
 *
 * Displays the audio quality classification (P0-P4) as a colored pill badge.
 * Used in two places:
 *
 * 1. **Studio header** — Shows the live estimated profile during recording,
 *    based on the server's metricsService heuristic (avgRms, clips, overlap).
 *
 * 2. **Results page** — Shows the final quality profile from the external
 *    processing pipeline (based on SNR, SRMR, and other acoustic metrics).
 *
 * ## Quality Profiles (defined by the backend)
 *
 * - **P0 (Pristine)** — Studio quality: SNR ≥25dB, no clips, minimal overlap
 * - **P1 (Good)**     — High quality: SNR ≥20dB, ≤5 clips
 * - **P2 (Acceptable)** — Usable: SNR ≥15dB, ≤20 clips
 * - **P3 (Poor)**     — Marginal: SNR ≥10dB, ≤50 clips
 * - **P4 (Reject)**   — Unusable: SNR <10dB or critical issues
 *
 * Colors follow a green-to-red gradient matching quality degradation.
 */

import type { QualityProfile } from '../shared';

interface QualityBadgeProps {
  profile: QualityProfile;
}

/** Color and label mapping for each quality tier */
const PROFILE_STYLES: Record<QualityProfile, { bg: string; label: string }> = {
  P0: { bg: 'bg-emerald-500', label: 'Pristine' },
  P1: { bg: 'bg-green-500', label: 'Good' },
  P2: { bg: 'bg-yellow-500', label: 'Acceptable' },
  P3: { bg: 'bg-orange-500', label: 'Poor' },
  P4: { bg: 'bg-red-500', label: 'Reject' },
};

export default function QualityBadge({ profile }: QualityBadgeProps) {
  const style = PROFILE_STYLES[profile];

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium text-white ${style.bg}`}>
      <span className="font-bold">{profile}</span>
      <span className="opacity-80">{style.label}</span>
    </span>
  );
}
