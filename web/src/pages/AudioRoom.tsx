import { useEffect, useCallback, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { PageLoader } from "@/components/ui/Loader";
import { ErrorState } from "@/components/shared/ErrorState";
import { Timer } from "@/components/session/Timer";
import { MuteButton } from "@/components/session/MuteButton";
import { MicLevelMeter } from "@/components/session/MicLevelMeter";
import { ParticipantStatus } from "@/components/session/ParticipantStatus";
import { ConnectionStatus } from "@/components/session/ConnectionStatus";
import { RecordingControls } from "@/components/session/RecordingControls";
import { useDaily } from "@/hooks/useDaily";
import { useRecordingTimer } from "@/hooks/useRecordingTimer";
import { useSessionApi } from "@/hooks/useSessionApi";
import { useSessionState, useSessionDispatch } from "@/context/SessionContext";

export function AudioRoom() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const sessionState = useSessionState();
  const dispatch = useSessionDispatch();
  const { loading: apiLoading, getSession, joinSession, leaveSession, startRecording, stopSession, pauseSession, resumeSession } = useSessionApi();

  const [guestLink, setGuestLink] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [roomUrl, setRoomUrl] = useState<string>("");
  const [token, setToken] = useState<string>("");

  // Load session data if navigated directly
  useEffect(() => {
    if (!sessionId) return;

    if (sessionState.sessionId === sessionId && sessionState.roomUrl && sessionState.token) {
      setRoomUrl(sessionState.roomUrl);
      setToken(sessionState.token);
      if (sessionState.guestJoinUrl) {
        setGuestLink(sessionState.guestJoinUrl);
      }
      return;
    }

    const loadSession = async () => {
      const session = await getSession(sessionId);
      if (session) {
        dispatch({
          type: "STATUS_UPDATED",
          payload: { status: session.status },
        });
      }
    };

    void loadSession();
  }, [sessionId, sessionState, dispatch, getSession]);

  const handleLeft = useCallback(() => {
    if (sessionId) {
      void leaveSession(sessionId);
      navigate(`/session/${sessionId}/complete`);
    }
  }, [sessionId, navigate, leaveSession]);

  const handleError = useCallback(
    (error: string) => {
      dispatch({ type: "ERROR_OCCURRED", payload: { error } });
    },
    [dispatch],
  );

  const daily = useDaily({
    roomUrl,
    token,
    onLeft: handleLeft,
    onError: handleError,
  });

  const timer = useRecordingTimer();

  // Auto-join when room URL and token are available
  useEffect(() => {
    if (roomUrl && token && !daily.isJoined) {
      void daily.join();
    }
  }, [roomUrl, token, daily.isJoined, daily.join]);

  // Notify server when we join the Daily room
  useEffect(() => {
    if (daily.isJoined && sessionId) {
      void joinSession(sessionId);
    }
  }, [daily.isJoined, sessionId, joinSession]);

  // Sync recording state with timer
  useEffect(() => {
    if (daily.isRecording) {
      timer.start();
    } else {
      timer.stop();
    }
  }, [daily.isRecording, timer.start, timer.stop]);

  const handleStart = async () => {
    if (!sessionId) return;
    const success = await startRecording(sessionId);
    if (success) {
      dispatch({ type: "STATUS_UPDATED", payload: { status: "recording" } });
      timer.start();
    }
  };

  const handleStop = async () => {
    if (!sessionId) return;
    const success = await stopSession(sessionId);
    if (success) {
      dispatch({ type: "STATUS_UPDATED", payload: { status: "processing" } });
      navigate(`/session/${sessionId}/complete`);
    }
  };

  const handlePause = async () => {
    if (!sessionId) return;
    const success = await pauseSession(sessionId);
    if (success) {
      dispatch({ type: "STATUS_UPDATED", payload: { status: "paused" } });
      timer.stop();
    }
  };

  const handleResume = async () => {
    if (!sessionId) return;
    const success = await resumeSession(sessionId);
    if (success) {
      dispatch({ type: "STATUS_UPDATED", payload: { status: "recording" } });
      timer.start();
    }
  };

  const handleCopyLink = async () => {
    if (!guestLink) return;
    await navigator.clipboard.writeText(guestLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Not ready yet
  if (!roomUrl || !token) {
    return (
      <PageContainer>
        {daily.error || sessionState.error ? (
          <ErrorState
            message={daily.error ?? sessionState.error ?? "Unknown error"}
            onRetry={() => navigate("/")}
          />
        ) : (
          <PageLoader />
        )}
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mx-auto max-w-lg animate-slide-up">
        {/* Guest invite link — host only */}
        {sessionState.isHost && guestLink && (
          <Card variant="accent" className="mb-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                  Guest Invite Link
                </span>
                <p className="mt-0.5 text-xs text-text-muted">
                  Share this link with your guest to join
                </p>
              </div>
              <button
                onClick={handleCopyLink}
                className="rounded-md bg-accent/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-accent transition-colors hover:bg-accent/20 cursor-pointer"
              >
                {copied ? "Copied!" : "Copy Link"}
              </button>
            </div>
          </Card>
        )}

        {/* Main recording interface */}
        <Card className="flex flex-col items-center gap-8 py-8 md:py-12">
          {/* Connection & mic level header */}
          <div className="flex w-full items-center justify-between px-2">
            <ConnectionStatus quality={daily.networkQuality} />
            <MicLevelMeter level={daily.micLevel} isMuted={daily.isMuted} />
          </div>

          {/* Timer */}
          <Timer
            formatted={timer.formatted}
            progress={timer.progress}
            isRecording={daily.isRecording}
          />

          {/* Mute button */}
          <MuteButton
            isMuted={daily.isMuted}
            onToggle={daily.toggleMute}
            disabled={!daily.isJoined}
          />

          {/* Recording controls */}
          <RecordingControls
            isRecording={daily.isRecording}
            isPaused={sessionState.status === "paused"}
            isHost={sessionState.isHost}
            isReadyToRecord={daily.participants.length >= 2}
            loading={apiLoading}
            onStart={handleStart}
            onStop={handleStop}
            onPause={handlePause}
            onResume={handleResume}
          />
        </Card>

        {/* Participants */}
        <Card className="mt-4">
          <ParticipantStatus participants={daily.participants} />
        </Card>
      </div>
    </PageContainer>
  );
}
