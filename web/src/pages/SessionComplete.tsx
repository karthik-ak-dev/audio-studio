import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageLoader } from "@/components/ui/Loader";
import { ErrorState } from "@/components/shared/ErrorState";
import { useSessionApi } from "@/hooks/useSessionApi";
import { SESSION_POLL_INTERVAL_MS } from "@/config/constants";
import type { Session, SessionStatus } from "@/types/session";

const statusBadgeVariant: Record<SessionStatus, "accent" | "warning" | "error" | "neutral"> = {
  created: "neutral",
  waiting_for_guest: "neutral",
  recording: "accent",
  paused: "warning",
  stopping: "warning",
  processing: "warning",
  completed: "accent",
  error: "error",
};

const statusLabel: Record<SessionStatus, string> = {
  created: "Created",
  waiting_for_guest: "Waiting",
  recording: "Recording",
  paused: "Paused",
  stopping: "Stopping",
  processing: "Processing",
  completed: "Completed",
  error: "Error",
};

export function SessionComplete() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { getSession, error } = useSessionApi();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const fetchSession = async () => {
      const result = await getSession(sessionId);
      if (result) setSession(result);
    };

    void fetchSession();

    // Poll while processing
    const interval = setInterval(async () => {
      const result = await getSession(sessionId);
      if (result) {
        setSession(result);
        if (result.status === "completed" || result.status === "error") {
          clearInterval(interval);
        }
      }
    }, SESSION_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [sessionId, getSession]);

  if (error) {
    return (
      <PageContainer>
        <ErrorState message={error} />
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

  const isProcessing = session.status === "processing" || session.status === "stopping";

  return (
    <PageContainer>
      <div className="mx-auto max-w-md animate-slide-up">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-black tracking-tight text-text md:text-4xl">
            Session{" "}
            <span className="text-gradient-accent">
              {session.status === "completed" ? "Complete" : "Summary"}
            </span>
          </h1>
        </div>

        <Card>
          <div className="flex flex-col gap-5">
            {/* Status */}
            <div className="flex items-center justify-between">
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

            {/* Details */}
            <div className="space-y-2">
              <DetailRow label="Session ID" value={session.session_id} mono />
              <DetailRow label="Host" value={session.host_name} />
              <DetailRow label="Guest" value={session.guest_name} />
              <DetailRow label="Segments" value={String(session.recording_segments)} />
              {session.recording_started_at && (
                <DetailRow label="Started" value={session.recording_started_at} />
              )}
              {session.recording_stopped_at && (
                <DetailRow label="Stopped" value={session.recording_stopped_at} />
              )}
            </div>

            {/* Error message */}
            {session.error_message && (
              <div className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {session.error_message}
              </div>
            )}

            {/* Processing indicator */}
            {isProcessing && (
              <div className="rounded-md bg-accent/[0.06] px-4 py-4 text-center">
                <p className="text-sm text-text-muted">
                  Processing audio files... This may take a few minutes.
                </p>
                <div className="relative mt-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="absolute inset-0 h-full w-1/3 animate-shimmer rounded-full bg-accent/40" />
                </div>
              </div>
            )}

            {/* Completed */}
            {session.status === "completed" && (
              <div className="rounded-md bg-accent/[0.06] px-4 py-4 text-center">
                <p className="text-sm text-accent">
                  Audio files are ready for processing
                </p>
                {session.s3_processed_prefix && (
                  <p className="mt-1 font-mono text-[10px] text-text-muted">
                    {session.s3_processed_prefix}
                  </p>
                )}
              </div>
            )}

            {/* New session button */}
            <Link to="/" className="w-full">
              <Button variant="secondary" size="md" className="w-full">
                New Session
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function DetailRow({ label, value, mono = false }: DetailRowProps) {
  return (
    <div className="flex items-center justify-between rounded-md bg-white/[0.03] px-4 py-2.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <span
        className={`text-sm text-text ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
