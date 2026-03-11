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
  if (!isHost) {
    return (
      <div className="text-center">
        <span className="text-xs text-text-muted">
          {isRecording
            ? "Recording in progress — host controls recording"
            : "Waiting for host to start recording"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Pre-recording: host can start */}
      {!isRecording && !isPaused && (
        <>
          <Button
            variant="primary"
            size="lg"
            onClick={onStart}
            loading={loading}
            disabled={!isReadyToRecord}
            className="w-full max-w-[200px]"
          >
            Start Recording
          </Button>
          {!isReadyToRecord && (
            <span className="text-xs text-text-muted">
              Waiting for guest to join...
            </span>
          )}
        </>
      )}

      {/* Recording: pause or stop */}
      {isRecording && (
        <div className="flex items-center gap-3">
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
        </div>
      )}

      {/* Paused: resume or end */}
      {isPaused && (
        <div className="flex items-center gap-3">
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
        </div>
      )}
    </div>
  );
}
