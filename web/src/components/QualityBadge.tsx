import type { QualityProfile } from '../shared';

interface QualityBadgeProps {
  profile: QualityProfile;
}

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
