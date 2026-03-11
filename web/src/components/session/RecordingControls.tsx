import { Button } from "@/components/ui/Button";

interface RecordingControlsProps {
  isRecording: boolean;
  isPaused: boolean;
  isHost: boolean;
  isReadyToRecord: boolean;
  loading: boolean;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}

export function RecordingControls({
  isRecording,
  isPaused,
  isHost,
  isReadyToRecord,
  loading,
  onStart,
  onStop,
  onPause,
  onResume,
}: RecordingControlsProps) {
  // Derive the actual recording state — isPaused takes priority over isRecording
  // because our session status is the source of truth (Daily SDK may lag behind)
  const activelyRecording = isRecording && !isPaused;
  const notStarted = !isRecording && !isPaused;

  if (!isHost) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06]">
        {isPaused ? (
          <span className="inline-flex h-3 w-3 rounded-sm bg-yellow-400/80" />
        ) : activelyRecording ? (
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-red-500" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
          </span>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-text-muted">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4l3 3" />
          </svg>
        )}
        <span className={`text-xs ${isPaused ? "text-yellow-400" : activelyRecording ? "text-red-400" : "text-text-muted"}`}>
          {isPaused
            ? "Recording paused by host"
            : activelyRecording
              ? "Recording in progress"
              : "Waiting for host to start recording"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      {/* Pre-recording: host can start */}
      {notStarted && (
        <>
          <Button
            variant="primary"
            size="lg"
            onClick={onStart}
            loading={loading}
            disabled={!isReadyToRecord}
            className="w-full max-w-[240px]"
          >
            Start Recording
          </Button>
          {!isReadyToRecord && (
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-blink rounded-full bg-text-muted/40" />
              <span className="text-xs text-text-muted">
                Waiting for guest to join...
              </span>
            </div>
          )}
        </>
      )}

      {/* Recording: pause or stop */}
      {activelyRecording && (
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="md"
            onClick={onPause}
            loading={loading}
          >
            Pause
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={onStop}
            loading={loading}
          >
            Stop Recording
          </Button>
        </div>
      )}

      {/* Paused: resume or end */}
      {isPaused && (
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="md"
            onClick={onResume}
            loading={loading}
          >
            Resume
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={onStop}
            loading={loading}
          >
            End Session
          </Button>
        </div>
      )}
    </div>
  );
}
