import { Button } from "@/components/ui/Button";

interface RecordingControlsProps {
  isRecording: boolean;
  isPaused: boolean;
  isHost: boolean;
  loading: boolean;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}

export function RecordingControls({
  isRecording,
  isPaused,
  isHost,
  loading,
  onStop,
  onPause,
  onResume,
}: RecordingControlsProps) {
  if (!isHost) {
    return (
      <div className="text-center">
        <span className="text-xs text-text-muted">
          {isRecording ? "Recording in progress — host controls recording" : "Waiting for host to manage recording"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-3">
      {isRecording && (
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={onPause}
            loading={loading}
          >
            Pause
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onStop}
            loading={loading}
          >
            Stop Recording
          </Button>
        </>
      )}

      {isPaused && (
        <>
          <Button
            variant="primary"
            size="sm"
            onClick={onResume}
            loading={loading}
          >
            Resume
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onStop}
            loading={loading}
          >
            End Session
          </Button>
        </>
      )}
    </div>
  );
}
