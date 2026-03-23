import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageLoader } from "@/components/ui/Loader";
import { ErrorState } from "@/components/shared/ErrorState";
import { useSessionApi } from "@/hooks/useSessionApi";
import { SESSION_POLL_INTERVAL_MS } from "@/config/constants";
import { getStoredEmail } from "@/pages/Landing";
import { SESSION_STATUS } from "@/types/session";
import type { Session, SessionStatus } from "@/types/session";

const statusBadgeVariant: Record<SessionStatus, "accent" | "warning" | "error" | "neutral"> = {
  created: "neutral",
  waiting_for_guest: "neutral",
  ready: "neutral",
  recording: "accent",
  paused: "warning",
  processing: "warning",
  completed: "accent",
  cancelled: "error",
  error: "error",
};

const statusLabel: Record<SessionStatus, string> = {
  created: "Created",
  waiting_for_guest: "Waiting",
  ready: "Ready",
  recording: "Recording",
  paused: "Paused",
  processing: "Processing",
  completed: "Completed",
  cancelled: "Cancelled",
  error: "Error",
};

const CANCEL_REASONS = [
  "Not satisfied with audio quality",
  "Recording had technical issues",
  "Wrong session / test recording",
  "Other",
] as const;

export function SessionComplete() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { pollSession, getSession, cancelSession, error } = useSessionApi();
  const [session, setSession] = useState<Session | null>(null);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    const fetchSession = async () => {
      const result = await getSession(sessionId);
      if (result) setSession(result);
    };

    void fetchSession();

    // Poll until terminal state
    const interval = setInterval(async () => {
      const result = await pollSession(sessionId);
      if (result) {
        setSession(result);
        if (result.status === SESSION_STATUS.COMPLETED || result.status === SESSION_STATUS.CANCELLED || result.status === SESSION_STATUS.ERROR) {
          clearInterval(interval);
        }
      }
    }, SESSION_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [sessionId, getSession, pollSession]);

  const handleCancel = useCallback(async () => {
    const userEmail = getStoredEmail();
    if (!sessionId || !cancelReason.trim() || !userEmail) return;
    setCancelling(true);
    const result = await cancelSession(sessionId, userEmail, cancelReason.trim());
    setCancelling(false);
    if (result === true) {
      // Re-fetch to get updated status
      const updated = await getSession(sessionId);
      if (updated) setSession(updated);
      setShowCancelForm(false);
    }
  }, [sessionId, cancelReason, cancelSession, getSession]);

  if (error) {
    return (
      <PageContainer>
        <ErrorState message={error} centered />
      </PageContainer>
    );
  }

  if (!session) {
    return (
      <PageContainer>
        <PageLoader />
      </PageContainer>
    );
  }

  const isProcessing = session.status === SESSION_STATUS.PROCESSING;
  const isCompleted = session.status === SESSION_STATUS.COMPLETED;
  const isCancelled = session.status === SESSION_STATUS.CANCELLED;
  const isError = session.status === SESSION_STATUS.ERROR;
  const isHost = getStoredEmail() === session.host_user_id;

  // Build participant names from roster
  const participantNames = Object.values(session.participants);

  return (
    <PageContainer>
      <div className="mx-auto max-w-lg animate-slide-up">
        {/* Header with status icon */}
        <div className="mb-10 text-center">
          <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl ring-1 ${
            isCompleted
              ? "bg-accent/10 ring-accent/20"
              : isError || isCancelled
                ? "bg-red-500/10 ring-red-500/20"
                : "bg-accent/10 ring-accent/20"
          }`}>
            {isCompleted ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 text-accent">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            ) : isError || isCancelled ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 text-red-400">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" x2="9" y1="9" y2="15" />
                <line x1="9" x2="15" y1="9" y2="15" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 text-accent animate-pulse">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            )}
          </div>
          <h1 className="text-3xl font-black tracking-tight text-text md:text-4xl">
            Session{" "}
            <span className={isError || isCancelled ? "text-red-400" : "text-gradient-accent"}>
              {isCompleted ? "Complete" : isCancelled ? "Cancelled" : isError ? "Failed" : "Processing"}
            </span>
          </h1>
          {isProcessing && (
            <p className="mt-3 text-sm text-text-muted">
              Your audio files are being processed...
            </p>
          )}
        </div>

        <Card>
          <div className="flex flex-col gap-5">
            {/* Status */}
            <div className="flex items-center justify-between rounded-md bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06]">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Status
              </span>
              <Badge variant={statusBadgeVariant[session.status]}>
                {isProcessing && (
                  <span className="mr-1.5 inline-block h-2 w-2 animate-spin rounded-full border border-current border-t-transparent" />
                )}
                {statusLabel[session.status]}
              </Badge>
            </div>

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-3">
              <DetailCard label="Host" value={session.host_name} />
              <DetailCard label="Guest" value={session.guest_name} />
              <DetailCard label="Pauses" value={String(session.pause_events?.length ?? 0)} />
              <DetailCard label="Participants" value={participantNames.join(", ") || "—"} />
            </div>

            {/* Timestamps */}
            {(session.recording_started_at || session.recording_stopped_at) && (
              <div className="space-y-2">
                {session.recording_started_at && (
                  <DetailRow label="Started" value={new Date(session.recording_started_at).toLocaleString()} />
                )}
                {session.recording_stopped_at && (
                  <DetailRow label="Stopped" value={new Date(session.recording_stopped_at).toLocaleString()} />
                )}
              </div>
            )}

            {/* Error message */}
            {session.error_message && (
              <div className="flex items-start gap-3 rounded-md bg-red-500/10 px-4 py-3 ring-1 ring-red-500/20">
                <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0 text-red-400">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
                </svg>
                <span className="text-sm text-red-400">{session.error_message}</span>
              </div>
            )}

            {/* Processing indicator */}
            {isProcessing && (
              <div className="rounded-md bg-accent/[0.04] px-4 py-5 text-center ring-1 ring-accent/10">
                <div className="mx-auto flex items-center justify-center gap-2">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:200ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:400ms]" />
                </div>
                <p className="mt-3 text-sm text-text-muted">
                  Converting and merging audio tracks
                </p>
                <div className="relative mt-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="absolute inset-0 h-full w-1/3 animate-shimmer rounded-full bg-accent/40" />
                </div>
              </div>
            )}

            {/* Completed — audio playback + cancel option */}
            {isCompleted && (
              <div className="space-y-3">
                <div className="rounded-md bg-accent/[0.06] px-4 py-4 ring-1 ring-accent/10">
                  <div className="flex items-center gap-2">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-accent">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                    </svg>
                    <span className="text-sm font-medium text-accent">Audio files ready</span>
                  </div>
                </div>

                {/* Combined audio player */}
                {session.combined_audio_presigned_url && (
                  <AudioTrack label="Combined" url={session.combined_audio_presigned_url} />
                )}

                {/* Individual track players */}
                {session.host_audio_presigned_url && (
                  <AudioTrack label={`Host — ${session.host_name}`} url={session.host_audio_presigned_url} />
                )}
                {session.guest_audio_presigned_url && (
                  <AudioTrack label={`Guest — ${session.guest_name}`} url={session.guest_audio_presigned_url} />
                )}

                {/* Cancel session CTA — host only */}
                {isHost && !showCancelForm && (
                  <button
                    onClick={() => setShowCancelForm(true)}
                    className="w-full text-center text-xs text-text-muted hover:text-red-400 transition-colors py-2"
                  >
                    Not satisfied with the quality? Cancel this session
                  </button>
                )}
                {isHost && showCancelForm && (
                  <div className="rounded-md bg-red-500/[0.06] px-4 py-4 ring-1 ring-red-500/20 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Cancel Session
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {CANCEL_REASONS.map((reason) => (
                        <button
                          key={reason}
                          onClick={() => setCancelReason(reason)}
                          className={`rounded-full px-3 py-1.5 text-xs ring-1 transition-colors ${
                            cancelReason === reason
                              ? "bg-red-500/20 text-red-400 ring-red-500/40"
                              : "bg-white/[0.03] text-text-muted ring-white/[0.06] hover:ring-white/[0.12]"
                          }`}
                        >
                          {reason}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        onClick={() => {
                          setShowCancelForm(false);
                          setCancelReason("");
                        }}
                      >
                        Back
                      </Button>
                      <button
                        onClick={handleCancel}
                        disabled={!cancelReason.trim() || cancelling}
                        className="flex-1 rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 ring-1 ring-red-500/30 transition-colors hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {cancelling ? "Cancelling..." : "Confirm Cancel"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Cancelled state */}
            {isCancelled && (
              <div className="flex items-start gap-3 rounded-md bg-red-500/10 px-4 py-3 ring-1 ring-red-500/20">
                <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0 text-red-400">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
                </svg>
                <span className="text-sm text-red-400">
                  {session.cancellation_reason ?? "Session was cancelled"}
                </span>
              </div>
            )}

            {/* Recording */}
            {session.recording_name && (
              <DetailRow label="Recording" value={session.recording_name} />
            )}

            {/* Session ID */}
            <DetailRow label="Session ID" value={session.session_id} />

            {/* Navigation buttons */}
            <div className="flex flex-col gap-2">
              <Link to="/dashboard" className="w-full">
                <Button variant="secondary" size="md" className="w-full">
                  Back to Dashboard
                </Button>
              </Link>
              {session.recording_id && (
                <Link to={`/session/new?recording_id=${session.recording_id}`} className="w-full">
                  <Button variant="ghost" size="md" className="w-full">
                    + Record another session
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06]">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <span className="text-sm font-medium text-text">
        {value}
      </span>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-white/[0.03] px-4 py-2.5 ring-1 ring-white/[0.06]">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <span className="text-xs text-text">{value}</span>
    </div>
  );
}

function AudioTrack({ label, url }: { label: string; url: string }) {
  return (
    <div className="rounded-md bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {label}
        </span>
        <a
          href={url}
          download
          className="text-[10px] font-medium text-accent hover:text-accent/80 transition-colors"
        >
          Download
        </a>
      </div>
      <audio controls preload="metadata" className="w-full h-8" style={{ colorScheme: "dark" }}>
        <source src={url} type="audio/wav" />
      </audio>
    </div>
  );
}
