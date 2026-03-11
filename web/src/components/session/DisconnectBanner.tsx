interface DisconnectBannerProps {
  name: string;
}

export function DisconnectBanner({ name }: DisconnectBannerProps) {
  return (
    <div className="mb-5 flex items-center gap-3 rounded-lg bg-yellow-500/10 px-4 py-3 ring-1 ring-yellow-500/20">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0 text-yellow-400">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" x2="12" y1="9" y2="13" />
        <line x1="12" x2="12.01" y1="17" y2="17" />
      </svg>
      <div>
        <p className="text-sm font-medium text-yellow-400">
          {name} disconnected
        </p>
        <p className="text-xs text-yellow-400/70">
          Recording paused. It will resume when they rejoin.
        </p>
      </div>
    </div>
  );
}
