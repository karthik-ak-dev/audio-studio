import { useEffect, useCallback, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageLoader } from "@/components/ui/Loader";
import { ErrorState } from "@/components/shared/ErrorState";
import { Timer } from "@/components/session/Timer";
import { MuteButton } from "@/components/session/MuteButton";
import { MicLevelMeter } from "@/components/session/MicLevelMeter";
import { ParticipantStatus } from "@/components/session/ParticipantStatus";
import { ConnectionStatus } from "@/components/session/ConnectionStatus";
import { RecordingControls } from "@/components/session/RecordingControls";
import { DisconnectBanner } from "@/components/session/DisconnectBanner";
import { useDaily } from "@/hooks/useDaily";
import { useRecordingTimer } from "@/hooks/useRecordingTimer";
import { useSessionApi } from "@/hooks/useSessionApi";
import type { ActionResult } from "@/hooks/useSessionApi";
import { useSessionState, useSessionDispatch } from "@/context/SessionContext";
import { SESSION_POLL_INTERVAL_MS } from "@/config/constants";
import type { DailySdkEvent } from "@/types/daily";

const STORAGE_PREFIX = "audio-studio:";
const TERMINAL_STATUSES = new Set(["processing", "completed", "error"]);
const POLL_FAIL_THRESHOLD = 3;

export function AudioRoom() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const sessionState = useSessionState();
  const dispatch = useSessionDispatch();
  const {
    loading: apiLoading,
    getSession,
    pollSession,
    joinSession,
    leaveSession,
    startRecording,
    endSession,
    pauseSession,
    resumeSession,
  } = useSessionApi();

  const [guestLink, setGuestLink] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [initialized, setInitialized] = useState<boolean>(false);
  const [pollFailCount, setPollFailCount] = useState<number>(0);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const joinNotifiedRef = useRef<boolean>(false);

  // ─── Derive roomUrl/token from context ───
  const roomUrl = sessionState.roomUrl ?? "";
  const token = sessionState.token ?? "";
  const isHost = sessionState.isHost;

  // ─── Helper: sync after action (handles "stale" 400 re-poll) ───
  const syncAfterAction = useCallback(
    async (result: ActionResult): Promise<boolean> => {
      if (!sessionId) return false;
      if (result === "stale") {
        // 400 = state diverged. Silently re-poll to sync UI, no error shown.
        const session = await pollSession(sessionId);
        if (session) {
          dispatch({ type: "SESSION_SYNCED", payload: { session } });
          if (TERMINAL_STATUSES.has(session.status)) {
            navigate(`/session/${sessionId}/complete`);
          }
        }
        return false;
      }
      if (result === true) {
        const session = await pollSession(sessionId);
        if (session) {
          dispatch({ type: "SESSION_SYNCED", payload: { session } });
        }
        return true;
      }
      return false;
    },
    [sessionId, pollSession, dispatch, navigate],
  );

  // ─── SDK event handler — triggers immediate server poll ───
  const handleSdkEvent = useCallback(
    (_event: DailySdkEvent) => {
      if (!sessionId) return;
      void pollSession(sessionId).then((session) => {
        if (session) {
          dispatch({ type: "SESSION_SYNCED", payload: { session } });
          if (TERMINAL_STATUSES.has(session.status)) {
            navigate(`/session/${sessionId}/complete`);
          }
        }
      });
    },
    [sessionId, pollSession, dispatch, navigate],
  );

  const handleDailyError = useCallback(
    (error: string) => {
      // Show inline error — don't navigate away, session state remains visible
      setSdkError(error);
    },
    [],
  );

  const daily = useDaily({
    roomUrl,
    token,
    onSdkEvent: handleSdkEvent,
    onError: handleDailyError,
  });

  const timer = useRecordingTimer();

  // ─── Reconnect handler for SDK errors ───
  const handleReconnect = useCallback(async () => {
    setSdkError(null);
    joinNotifiedRef.current = false;
    await daily.leave();
    void daily.join();
  }, [daily]);

  // ─── 1. Initialize: load session from server, read token from sessionStorage ───
  useEffect(() => {
    if (!sessionId || initialized) return;

    const init = async () => {
      // Try context first (just created or just joined)
      if (sessionState.sessionId === sessionId && sessionState.roomUrl && sessionState.token) {
        if (sessionState.guestJoinUrl) {
          setGuestLink(sessionState.guestJoinUrl);
        }
        const session = await getSession(sessionId);
        if (session) {
          dispatch({ type: "SESSION_SYNCED", payload: { session } });
          if (TERMINAL_STATUSES.has(session.status)) {
            navigate(`/session/${sessionId}/complete`);
            return;
          }
        }
        setInitialized(true);
        return;
      }

      // Read token from sessionStorage (refresh scenario)
      const stored = sessionStorage.getItem(`${STORAGE_PREFIX}${sessionId}`);
      if (!stored) {
        navigate("/");
        return;
      }

      const { token: storedToken, isHost: storedIsHost, roomUrl: storedRoomUrl, guestJoinUrl: storedGuestJoinUrl } = JSON.parse(stored) as {
        token: string;
        isHost: boolean;
        roomUrl: string;
        guestJoinUrl?: string;
      };

      const session = await getSession(sessionId);
      if (!session) {
        navigate("/");
        return;
      }

      if (TERMINAL_STATUSES.has(session.status)) {
        navigate(`/session/${sessionId}/complete`);
        return;
      }

      dispatch({
        type: "SESSION_LOADED",
        payload: {
          sessionId,
          roomUrl: storedRoomUrl || session.daily_room_url || "",
          token: storedToken,
          isHost: storedIsHost,
        },
      });
      dispatch({ type: "SESSION_SYNCED", payload: { session } });

      if (storedIsHost && storedGuestJoinUrl) {
        setGuestLink(storedGuestJoinUrl);
      }

      setInitialized(true);
    };

    void init();
  }, [sessionId, initialized, sessionState, getSession, dispatch, navigate]);

  // ─── 2. Auto-join Daily room ───
  useEffect(() => {
    if (roomUrl && token && !daily.isJoined && initialized && !sdkError) {
      void daily.join();
    }
  }, [roomUrl, token, daily.isJoined, daily.join, initialized, sdkError]);

  // ─── 3. Notify server of join (blocking, once, with retry) ───
  const userName = isHost ? (sessionState.hostName ?? "") : (sessionState.guestName ?? "");
  useEffect(() => {
    if (
      daily.isJoined &&
      sessionId &&
      daily.localConnectionId &&
      daily.localUserId &&
      userName &&
      !joinNotifiedRef.current
    ) {
      joinNotifiedRef.current = true;
      void joinSession(sessionId, {
        user_id: daily.localUserId,
        connection_id: daily.localConnectionId,
        user_name: userName,
      });
    }
  }, [daily.isJoined, daily.localConnectionId, daily.localUserId, sessionId, userName, joinSession]);

  // ─── 4. Interval poll (every 3s, silent) ───
  useEffect(() => {
    if (!sessionId || !daily.isJoined) return;

    let active = true;

    const poll = setInterval(async () => {
      if (!active) return;
      const session = await pollSession(sessionId);
      if (!active) return;

      if (session) {
        setPollFailCount(0);
        dispatch({ type: "SESSION_SYNCED", payload: { session } });

        if (TERMINAL_STATUSES.has(session.status)) {
          clearInterval(poll);
          navigate(`/session/${sessionId}/complete`);
        }
      } else {
        setPollFailCount((prev) => prev + 1);
      }
    }, SESSION_POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(poll);
    };
  }, [sessionId, daily.isJoined, pollSession, dispatch, navigate]);

  // ─── 5. Sync timer with server recording state ───
  useEffect(() => {
    if (sessionState.status === "recording" && sessionState.recordingStartedAt) {
      timer.syncWithServer(sessionState.recordingStartedAt);
      if (!timer.isRunning) timer.start();
    } else if (sessionState.status === "paused") {
      timer.stop();
    } else if (sessionState.status === "ready" || sessionState.status === "created" || sessionState.status === "waiting_for_guest") {
      timer.reset();
    }
  }, [sessionState.status, sessionState.recordingStartedAt, timer]);

  // ─── 6. Auto-mute on pause, auto-unmute on resume ───
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = sessionState.status;
    prevStatusRef.current = curr;

    if (!daily.isJoined || prev === null) return;

    // Transition: recording → paused — auto-mute
    if (prev === "recording" && curr === "paused") {
      daily.setMuted(true);
    }
    // Transition: paused → recording — auto-unmute
    if (prev === "paused" && curr === "recording") {
      daily.setMuted(false);
    }
  }, [sessionState.status, daily.isJoined, daily.setMuted]);

  // ─── Action handlers (with 400 re-poll) ───
  const handleStart = async () => {
    if (!sessionId) return;
    const result = await startRecording(sessionId);
    await syncAfterAction(result);
  };

  const handleEnd = async () => {
    if (!sessionId) return;
    const result = await endSession(sessionId);
    if (result === true) {
      navigate(`/session/${sessionId}/complete`);
    } else {
      await syncAfterAction(result);
    }
  };

  const handlePause = async () => {
    if (!sessionId) return;
    const result = await pauseSession(sessionId);
    await syncAfterAction(result);
  };

  const handleResume = async () => {
    if (!sessionId) return;
    const result = await resumeSession(sessionId);
    await syncAfterAction(result);
  };

  const handleLeave = async () => {
    if (!sessionId || !daily.localUserId) return;
    await leaveSession(sessionId, { user_id: daily.localUserId });
    await daily.leave();
    navigate(`/session/${sessionId}/complete`);
  };

  const handleCopyLink = async () => {
    if (!guestLink) return;
    await navigator.clipboard.writeText(guestLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── Derived state from server ───
  const isRecording = sessionState.status === "recording";
  const isPaused = sessionState.status === "paused";
  const canStartRecording = sessionState.status === "ready" && sessionState.participantCount >= 2;
  const canResume = isPaused && sessionState.participantCount >= 2;
  const showConnectionWarning = pollFailCount >= POLL_FAIL_THRESHOLD;

  // Find disconnected participant name for the banner
  const disconnectedName = (() => {
    if (!isPaused || sessionState.participantCount >= 2) return null;
    const activeSet = new Set(sessionState.activeParticipants);
    for (const [userId, name] of Object.entries(sessionState.participantsRoster)) {
      if (!activeSet.has(userId)) return name;
    }
    return null;
  })();

  // ─── Loading / fatal error state ───
  if (!initialized || (!roomUrl && !sessionState.error)) {
    return (
      <PageContainer>
        {sessionState.error ? (
          <ErrorState
            message={sessionState.error}
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
        {/* SDK error banner with reconnect — inline, doesn't replace page */}
        {sdkError && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-lg bg-red-500/10 px-4 py-3 ring-1 ring-red-500/20">
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0 text-red-400">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" x2="9" y1="9" y2="15" />
                <line x1="9" x2="15" y1="9" y2="15" />
              </svg>
              <p className="text-sm text-red-400">{sdkError}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={handleReconnect}>
              Reconnect
            </Button>
          </div>
        )}

        {/* Connection warning after consecutive poll failures */}
        {showConnectionWarning && (
          <div className="mb-5 flex items-center gap-3 rounded-lg bg-yellow-500/10 px-4 py-3 ring-1 ring-yellow-500/20">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0 text-yellow-400">
              <path d="M1 1l22 22" />
              <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
              <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
              <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
              <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" x2="12.01" y1="20" y2="20" />
            </svg>
            <p className="text-sm text-yellow-400">
              Connection lost. Trying to reconnect...
            </p>
          </div>
        )}

        {/* Disconnect banner */}
        {disconnectedName && (
          <DisconnectBanner name={disconnectedName} />
        )}

        {/* Two-column layout: Left = recording, Right = invite + participants */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">

          {/* ─── Left column: Recording controls ─── */}
          <div className="lg:col-span-8">
            <Card className="relative h-full overflow-hidden">
              {/* Recording pulse border */}
              {isRecording && (
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
                  isRecording={isRecording}
                  isPaused={isPaused}
                />

                {/* Mute button */}
                <MuteButton
                  isMuted={daily.isMuted}
                  onToggle={daily.toggleMute}
                  disabled={!daily.isJoined || isPaused}
                />

                {/* Recording controls */}
                <RecordingControls
                  status={sessionState.status}
                  isHost={isHost}
                  canStartRecording={canStartRecording}
                  canResume={canResume}
                  loading={apiLoading}
                  onStart={handleStart}
                  onEnd={handleEnd}
                  onPause={handlePause}
                  onResume={handleResume}
                  onLeave={handleLeave}
                />
              </div>
            </Card>
          </div>

          {/* ─── Right column: Invite + Participants + Info ─── */}
          <div className="flex flex-col gap-5 lg:col-span-4">
            {/* Guest invite link — host only */}
            {isHost && guestLink && (
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

            {/* Participants — server-driven roster */}
            <Card>
              <ParticipantStatus
                participantsRoster={sessionState.participantsRoster}
                activeParticipants={sessionState.activeParticipants}
                sdkParticipants={daily.participants}
                localUserId={daily.localUserId}
              />
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
                      isRecording
                        ? "Recording"
                        : isPaused
                          ? "Paused"
                          : daily.isJoined
                            ? "Connected"
                            : "Connecting..."
                    }
                  />
                  {sessionState.pauseEvents.length > 0 && (
                    <InfoRow label="Pauses" value={String(sessionState.pauseEvents.length)} />
                  )}
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
