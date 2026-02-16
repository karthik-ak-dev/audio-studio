import type { RecordingWarningPayload } from '../shared';

interface WarningBannerProps {
  warnings: RecordingWarningPayload[];
}

export default function WarningBanner({ warnings }: WarningBannerProps) {
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {warnings.map((warning, i) => (
        <div
          key={`${warning.type}-${i}`}
          className={`px-4 py-2 rounded-lg text-sm ${
            warning.severity === 'critical'
              ? 'bg-red-900/50 border border-red-500 text-red-200'
              : 'bg-yellow-900/50 border border-yellow-500 text-yellow-200'
          }`}
        >
          <span className="font-medium">{warning.speaker}:</span> {warning.message}
        </div>
      ))}
    </div>
  );
}
