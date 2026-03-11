import type { NetworkQuality } from "@/types/daily";

interface ConnectionStatusProps {
  quality: NetworkQuality;
}

const qualityConfig: Record<NetworkQuality, { label: string; color: string; bars: number }> = {
  good: { label: "Strong", color: "bg-accent", bars: 3 },
  warning: { label: "Fair", color: "bg-yellow-400", bars: 2 },
  bad: { label: "Poor", color: "bg-red-400", bars: 1 },
  unknown: { label: "Connecting", color: "bg-text-muted", bars: 0 },
};

export function ConnectionStatus({ quality }: ConnectionStatusProps) {
  const config = qualityConfig[quality];

  return (
    <div className="flex items-center gap-2 rounded-md bg-white/[0.03] px-2.5 py-1.5 ring-1 ring-white/[0.06]">
      <div className="flex items-end gap-[2px]">
        {[1, 2, 3].map((bar) => (
          <div
            key={bar}
            className={`
              w-[3px] rounded-full transition-colors duration-300
              ${bar <= config.bars ? config.color : "bg-white/10"}
            `}
            style={{ height: `${bar * 4 + 4}px` }}
          />
        ))}
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        {config.label}
      </span>
    </div>
  );
}
