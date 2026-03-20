import { useEffect, useCallback, useRef, useState, type ReactNode } from "react";
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
const TERMINAL_STATUSES = new Set(["processing", "completed", "cancelled", "error"]);
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
  const [copied, setCopied] = useState<string | null>(null);
  const [initialized, setInitialized] = useState<boolean>(false);
  const [initError, setInitError] = useState<{ title: string; message: string; onRetry?: () => void } | null>(null);
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
      // Daily ejects the old tab when enforce_unique_user_ids is enabled
      // and the same user_id joins from another tab/browser.
      const isEjected = error.toLowerCase().includes("duplicate") || error.toLowerCase().includes("ejected");
      if (isEjected) {
        setInitError({
          title: "Already Connected",
          message: "This session was opened in another tab. Close this tab or rejoin here.",
          onRetry: () => window.location.reload(),
        });
        return;
      }
      // Room expiry — don't show error banner; the poll will catch the
      // terminal status and redirect to /complete automatically.
      const isRoomExpiry = error.toLowerCase().includes("meeting has ended")
        || error.toLowerCase().includes("exp");
      if (isRoomExpiry) return;

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

  // ─── 1. Initialize: load session, resolve token, route to correct view ───
  //
  // Entry scenarios:
  //   A. Context already has token (just created/joined → navigated here)
  //   B. sessionStorage has token (page refresh while in session)
  //   C. No token — user pasted URL or bookmark
  //
  // Session states on load:
  //   - Active (created/waiting/ready/recording/paused): need token to join Daily
  //   - Terminal (processing/completed/error): redirect to /complete
  //   - Not found (404): show error
  //
  useEffect(() => {
    if (!sessionId || initialized) return;

    const init = async () => {
      // ── A. Token in React context (fresh create/join navigation) ──
      if (sessionState.sessionId === sessionId && sessionState.roomUrl && sessionState.token) {
        if (sessionState.guestJoinUrl) {
          setGuestLink(sessionState.guestJoinUrl);
        }
        const session = await getSession(sessionId);
        if (session) {
          dispatch({ type: "SESSION_SYNCED", payload: { session } });
          if (TERMINAL_STATUSES.has(session.status)) {
            navigate(`/session/${sessionId}/complete`, { replace: true });
            return;
          }
        }
        setInitialized(true);
        return;
      }

      // ── B & C. Need to fetch session first to decide routing ──
      const session = await getSession(sessionId);

      // Session not found (404) — show inline error, don't silently redirect
      if (!session) {
        setInitError({
          title: "Session Not Found",
          message: "This session doesn't exist or has expired.",
        });
        return;
      }

      // Terminal state — always redirect to /complete (works with or without token)
      if (TERMINAL_STATUSES.has(session.status)) {
        navigate(`/session/${sessionId}/complete`, { replace: true });
        return;
      }

      // ── Active session — need a token to join ──
      const stored = sessionStorage.getItem(`${STORAGE_PREFIX}${sessionId}`);
      if (!stored) {
        // No token for an active session — user can't join without an invite link
        setInitError({
          title: "Session In Progress",
          message: "This session is currently active. You need an invite link from the host to join.",
        });
        return;
      }

      // ── B. Restore from sessionStorage (refresh) ──
      const { token: storedToken, isHost: storedIsHost, roomUrl: storedRoomUrl, guestJoinUrl: storedGuestJoinUrl } = JSON.parse(stored) as {
        token: string;
        isHost: boolean;
        roomUrl: string;
        guestJoinUrl?: string;
      };

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
    if (roomUrl && token && !daily.isJoined && initialized && !sdkError && !initError) {
      void daily.join();
    }
  }, [roomUrl, token, daily.isJoined, daily.join, initialized, sdkError, initError]);

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
  // Gated on `initialized` (not `daily.isJoined`) so polling continues
  // after Daily disconnects (e.g. room expiry ejection) and catches
  // terminal status updates from webhooks.
  useEffect(() => {
    if (!sessionId || !initialized) return;

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
  }, [sessionId, initialized, pollSession, dispatch, navigate]);

  // ─── 5. Sync timer with server recording state ───
  useEffect(() => {
    if (
      (sessionState.status === "recording" || sessionState.status === "paused") &&
      sessionState.recordingStartedAt
    ) {
      timer.sync(
        sessionState.recordingStartedAt,
        sessionState.pauseEvents,
        sessionState.status === "recording",
      );
    } else if (
      sessionState.status === "ready" ||
      sessionState.status === "created" ||
      sessionState.status === "waiting_for_guest"
    ) {
      timer.reset();
    }
  }, [sessionState.status, sessionState.recordingStartedAt, sessionState.pauseEvents, timer.sync, timer.reset]);

  // ─── 6. Auto-mute on pause, auto-unmute on resume ───
  const prevStatusRef = useRef<string | null>(null);
  const muteSyncedRef = useRef(false);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = sessionState.status;
    prevStatusRef.current = curr;

    if (!daily.isJoined || curr === null) return;

    // First time we have both isJoined=true AND a known status — sync mute
    if (!muteSyncedRef.current) {
      muteSyncedRef.current = true;
      if (curr === "paused") {
        daily.setMuted(true);
      }
      return;
    }

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

  const handleCopyLink = async (link: string, label: string) => {
    await navigator.clipboard.writeText(link);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  // ─── Derived state ───
  const isRecording = sessionState.status === "recording";
  const isPaused = sessionState.status === "paused";
  const canStartRecording = sessionState.status === "ready" && sessionState.participantCount >= 2;
  const canResume = isPaused && sessionState.participantCount >= 2;
  const showConnectionWarning = pollFailCount >= POLL_FAIL_THRESHOLD;

  // The room is "ready" when server state is synced and Daily SDK is connected
  const isRoomReady = daily.isJoined && sessionState.status !== null;

  // Find disconnected participant name for the banner
  const disconnectedName = (() => {
    if (!isPaused || sessionState.participantCount >= 2) return null;
    const activeSet = new Set(sessionState.activeParticipants);
    for (const [userId, name] of Object.entries(sessionState.participantsRoster)) {
      if (!activeSet.has(userId)) return name;
    }
    return null;
  })();

  // ─── Loading / error state ───
  if (initError) {
    return (
      <PageContainer>
        <ErrorState
          title={initError.title}
          message={initError.message}
          onRetry={initError.onRetry ?? (() => navigate("/"))}
          centered
        />
      </PageContainer>
    );
  }

  if (!initialized || (!roomUrl && !sessionState.error)) {
    return (
      <PageContainer>
        {sessionState.error ? (
          <ErrorState
            message={sessionState.error}
            onRetry={() => navigate("/")}
            centered
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
        {/* SDK error banner with reconnect */}
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

              {isRoomReady ? (
                <div className="flex flex-col items-center gap-8 py-8 md:py-12">
                  {/* Status bar */}
                  <div className="flex w-full items-center justify-between px-2">
                    <ConnectionStatus quality={daily.networkQuality} />
                    <MicLevelMeter level={daily.micLevel} isMuted={daily.isMuted} />
                  </div>

                  {/* Timer */}
                  <Timer
                    formatted={timer.formatted}
                    isRecording={isRecording}
                    isPaused={isPaused}
                    roomExpiresAt={sessionState.roomExpiresAt}
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
              ) : (
                <RecordingCardSkeleton />
              )}
            </Card>
          </div>

          {/* ─── Right column: Invite + Participants + Info ─── */}
          <div className="flex flex-col gap-5 lg:col-span-4">
            {/* Host sees: Invite Guest link | Guest sees: Host Rejoin link */}
            {isHost && (guestLink || sessionState.guestRejoinUrl) && (
              <Card variant="accent">
                <LinkCard
                  label="Invite Guest"
                  sublabel={<>Share with <span className="text-text">{sessionState.guestName}</span></>}
                  link={guestLink || sessionState.guestRejoinUrl!}
                  copied={copied}
                  onCopy={handleCopyLink}
                  copyId="guest"
                />
              </Card>
            )}
            {!isHost && sessionState.hostRejoinUrl && (
              <Card variant="accent">
                <LinkCard
                  label="Help Host Rejoin"
                  sublabel={<>Send to <span className="text-text">{sessionState.hostName}</span> if they got disconnected</>}
                  link={sessionState.hostRejoinUrl}
                  copied={copied}
                  onCopy={handleCopyLink}
                  copyId="host"
                />
              </Card>
            )}

            {isRoomReady ? (
              <>
                {/* Participants — server-driven roster */}
                <Card>
                  <ParticipantStatus
                    participantsRoster={sessionState.participantsRoster}
                    activeParticipants={sessionState.activeParticipants}
                    sdkParticipants={daily.participants}
                    localUserId={daily.localUserId}
                    isMuted={daily.isMuted}
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
                              : "Connected"
                        }
                      />
                      {sessionState.pauseEvents.length > 0 && (
                        <InfoRow label="Pauses" value={String(sessionState.pauseEvents.length)} />
                      )}
                    </div>
                  </div>
                </Card>
              </>
            ) : (
              <>
                <SidebarCardSkeleton lines={2} />
                <SidebarCardSkeleton lines={4} />
              </>
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

// ─── Skeleton components ─────────────────────────

function SkeletonBar({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-white/[0.06] ${className}`} />
  );
}

function RecordingCardSkeleton() {
  return (
    <div className="flex flex-col items-center gap-8 py-8 md:py-12">
      {/* Status bar placeholders */}
      <div className="flex w-full items-center justify-between px-2">
        <SkeletonBar className="h-7 w-24" />
        <SkeletonBar className="h-7 w-28" />
      </div>

      {/* Timer placeholder */}
      <div className="flex flex-col items-center gap-4">
        <SkeletonBar className="h-4 w-20" />
        <SkeletonBar className="h-14 w-48" />
        <SkeletonBar className="h-1 w-[280px] max-w-full" />
      </div>

      {/* Mute button placeholder */}
      <div className="flex flex-col items-center gap-2">
        <div className="h-16 w-16 animate-pulse rounded-full bg-white/[0.06]" />
        <SkeletonBar className="h-3 w-20" />
      </div>

      {/* Controls placeholder */}
      <SkeletonBar className="h-10 w-48" />
    </div>
  );
}

function SidebarCardSkeleton({ lines }: { lines: number }) {
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <SkeletonBar className="h-3 w-24" />
        <div className="space-y-2">
          {Array.from({ length: lines }, (_, i) => (
            <SkeletonBar key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </Card>
  );
}

function LinkCard({
  label,
  sublabel,
  link,
  copied,
  onCopy,
  copyId,
}: {
  label: string;
  sublabel: ReactNode;
  link: string;
  copied: string | null;
  onCopy: (link: string, label: string) => void;
  copyId: string;
}) {
  const isCopied = copied === copyId;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] text-accent">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </div>
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-accent">
            {label}
          </span>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {sublabel}
          </p>
        </div>
      </div>

      <div className="truncate rounded-md bg-black/30 px-3 py-2 font-mono text-[10px] text-text-muted ring-1 ring-white/[0.06]">
        {link}
      </div>

      <button
        onClick={() => onCopy(link, copyId)}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-accent/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-accent transition-colors hover:bg-accent/20"
      >
        {isCopied ? (
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
