import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { SessionStatus } from "@/types/session";

interface RecordingControlsProps {
  status: SessionStatus | null;
  isHost: boolean;
  canStartRecording: boolean;
  canResume: boolean;
  loading: boolean;
  onStart: () => void;
  onEnd: () => void;
  onPause: () => void;
  onResume: () => void;
  onLeave: () => void;
}

export function RecordingControls({
  status,
  isHost,
  canStartRecording,
  canResume,
  loading,
  onStart,
  onEnd,
  onPause,
  onResume,
  onLeave,
}: RecordingControlsProps) {
  const [showEndConfirm, setShowEndConfirm] = useState<boolean>(false);

  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const isReady = status === "ready" || status === "created";

  // Guest view — status indicator only
  if (!isHost) {
    return (
      <div className="flex flex-col items-center gap-3 w-full">
        <div className="flex items-center gap-2 rounded-md bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06]">
          {isPaused ? (
            <span className="inline-flex h-3 w-3 rounded-sm bg-yellow-400/80" />
          ) : isRecording ? (
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
          <span className={`text-xs ${isPaused ? "text-yellow-400" : isRecording ? "text-red-400" : "text-text-muted"}`}>
            {isPaused
              ? "Recording paused by host"
              : isRecording
                ? "Recording in progress"
                : "Waiting for host to start recording"}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onLeave}>
          Leave Session
        </Button>
      </div>
    );
  }

  // End session confirmation dialog
  if (showEndConfirm) {
    return (
      <div className="flex w-full flex-col items-center gap-3">
        <p className="text-sm text-text-muted">
          End session and stop recording? This cannot be undone.
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="md"
            onClick={() => setShowEndConfirm(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={() => {
              setShowEndConfirm(false);
              onEnd();
            }}
            loading={loading}
          >
            End Session
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      {/* Pre-recording: host can start */}
      {isReady && (
        <>
          <Button
            variant="primary"
            size="lg"
            onClick={onStart}
            loading={loading}
            disabled={!canStartRecording}
            className="w-full max-w-[240px]"
          >
            Start Recording
          </Button>
          {!canStartRecording && (
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-blink rounded-full bg-text-muted/40" />
              <span className="text-xs text-text-muted">
                Waiting for guest to join...
              </span>
            </div>
          )}
        </>
      )}

      {/* Recording: pause or end */}
      {isRecording && (
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
            onClick={() => setShowEndConfirm(true)}
          >
            End Session
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
            disabled={!canResume}
          >
            Resume
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={() => setShowEndConfirm(true)}
          >
            End Session
          </Button>
          {!canResume && (
            <span className="text-xs text-text-muted">
              Waiting for both participants...
            </span>
          )}
        </div>
      )}
    </div>
  );
}
