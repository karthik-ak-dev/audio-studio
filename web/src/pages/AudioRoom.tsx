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
import { SESSION_POLL_INTERVAL_MS } from "@/config/constants";

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

  // Poll session status so guests (and host) stay in sync with server state.
  // This is how the guest learns about pause/resume/stop actions from the host.
  useEffect(() => {
    if (!sessionId || !daily.isJoined) return;

    let active = true;

    const poll = setInterval(async () => {
      if (!active) return;
      const session = await getSession(sessionId);
      if (!active || !session) return;

      // Always sync status from server
      dispatch({ type: "STATUS_UPDATED", payload: { status: session.status } });

      // If session ended, navigate to complete page
      if (session.status === "processing" || session.status === "completed" || session.status === "error") {
        clearInterval(poll);
        navigate(`/session/${sessionId}/complete`);
      }
    }, SESSION_POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(poll);
    };
  }, [sessionId, daily.isJoined, getSession, dispatch, navigate]);

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
      <div className="animate-slide-up">
        {/* Two-column layout: Left = recording, Right = invite + participants */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">

          {/* ─── Left column: Recording controls ─── */}
          <div className="lg:col-span-8">
            <Card className="relative h-full overflow-hidden">
              {/* Recording pulse border */}
              {daily.isRecording && (
                <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-red-500/30 animate-pulse" />
              )}

              <div className="flex flex-col items-center gap-8 py-8 md:py-12">
                {/* Status bar */}
                <div className="flex w-full items-center justify-between px-2">
                  <ConnectionStatus quality={daily.networkQuality} />
                  <MicLevelMeter level={daily.micLevel} isMuted={daily.isMuted} />
                </div>

                {/* Timer */}
                <Timer
                  formatted={timer.formatted}
                  progress={timer.progress}
                  isRecording={daily.isRecording}
                  isPaused={sessionState.status === "paused"}
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
              </div>
            </Card>
          </div>

          {/* ─── Right column: Invite + Participants + Info ─── */}
          <div className="flex flex-col gap-5 lg:col-span-4">
            {/* Guest invite link — host only */}
            {sessionState.isHost && guestLink && (
              <Card variant="accent">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] text-accent">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                    </div>
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-accent">
                        Invite Guest
                      </span>
                      <p className="mt-0.5 text-[11px] text-text-muted">
                        Share with <span className="text-text">{sessionState.guestName}</span>
                      </p>
                    </div>
                  </div>

                  <div className="truncate rounded-md bg-black/30 px-3 py-2 font-mono text-[10px] text-text-muted ring-1 ring-white/[0.06]">
                    {guestLink}
                  </div>

                  <button
                    onClick={handleCopyLink}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-accent/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-accent transition-colors hover:bg-accent/20"
                  >
                    {copied ? (
                      <>
                        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                        </svg>
                        Copy Link
                      </>
                    )}
                  </button>
                </div>
              </Card>
            )}

            {/* Participants */}
            <Card>
              <ParticipantStatus participants={daily.participants} />
            </Card>

            {/* Session info */}
            <Card>
              <div className="flex flex-col gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Session Info
                </span>
                <div className="space-y-2">
                  <InfoRow label="Session ID" value={sessionId ?? ""} mono />
                  {sessionState.hostName && (
                    <InfoRow label="Host" value={sessionState.hostName} />
                  )}
                  {sessionState.guestName && (
                    <InfoRow label="Guest" value={sessionState.guestName} />
                  )}
                  <InfoRow
                    label="Status"
                    value={
                      daily.isRecording
                        ? "Recording"
                        : sessionState.status === "paused"
                          ? "Paused"
                          : daily.isJoined
                            ? "Connected"
                            : "Connecting..."
                    }
                  />
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-white/[0.03] px-3 py-2 ring-1 ring-white/[0.06]">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      <span className={`text-xs text-text ${mono ? "font-mono text-[10px]" : ""}`}>{value}</span>
    </div>
  );
}
