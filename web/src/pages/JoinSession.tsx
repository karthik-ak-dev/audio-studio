import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageLoader } from "@/components/ui/Loader";
import { ErrorState } from "@/components/shared/ErrorState";
import { useSessionApi } from "@/hooks/useSessionApi";
import { useSessionDispatch } from "@/context/SessionContext";
import { SESSION_STATUS } from "@/types/session";

const STORAGE_PREFIX = "recstudio:";
const TERMINAL_STATUSES: Set<string> = new Set([SESSION_STATUS.PROCESSING, SESSION_STATUS.COMPLETED, SESSION_STATUS.ERROR]);

export function JoinSession() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useSessionDispatch();
  const { loading, error, getSession } = useSessionApi();

  const [sessionLoaded, setSessionLoaded] = useState<boolean>(false);
  const [hostName, setHostName] = useState<string>("");
  const [guestName, setGuestName] = useState<string>("");
  const [roomUrl, setRoomUrl] = useState<string>("");

  const token = searchParams.get("t");
  const role = searchParams.get("role");
  const isHostRejoin = role === "host";

  useEffect(() => {
    if (!sessionId) return;

    const loadSession = async () => {
      const session = await getSession(sessionId);
      if (session) {
        // If session is already finished, redirect to complete page
        if (TERMINAL_STATUSES.has(session.status)) {
          navigate(`/session/${sessionId}/complete`, { replace: true });
          return;
        }
        setHostName(session.host_name);
        setGuestName(session.guest_name);
        setRoomUrl(session.daily_room_url ?? "");
        setSessionLoaded(true);
      }
    };

    void loadSession();
  }, [sessionId, getSession, navigate]);

  const handleJoin = () => {
    if (!sessionId || !token) return;

    // Store token in sessionStorage for refresh persistence
    sessionStorage.setItem(
      `${STORAGE_PREFIX}${sessionId}`,
      JSON.stringify({
        token,
        isHost: isHostRejoin,
        roomUrl,
      }),
    );

    dispatch({
      type: "SESSION_LOADED",
      payload: {
        sessionId,
        roomUrl,
        token,
        isHost: isHostRejoin,
      },
    });

    navigate(`/session/${sessionId}`);
  };

  if (loading && !sessionLoaded) {
    return (
      <PageContainer>
        <PageLoader />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <ErrorState
          title="Session Not Found"
          message={error}
          onRetry={() => navigate("/")}
          centered
        />
      </PageContainer>
    );
  }

  if (!token) {
    return (
      <PageContainer>
        <ErrorState
          title="Invalid Link"
          message="This join link is missing the required token. Ask the host for a new link."
          centered
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mx-auto max-w-lg animate-slide-up">
        {/* Header */}
        <div className="mb-10 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 ring-1 ring-accent/20">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-7 w-7 text-accent"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" x2="19" y1="8" y2="14" />
              <line x1="22" x2="16" y1="11" y2="11" />
            </svg>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-text md:text-4xl">
            {isHostRejoin ? "Rejoin" : "Join"} <span className="text-gradient-accent">Session</span>
          </h1>
          <p className="mt-3 text-sm text-text-muted">
            {isHostRejoin
              ? "Rejoin your session as the host"
              : "You've been invited to an audio recording session"}
          </p>
        </div>

        <Card>
          <div className="flex flex-col gap-6">
            {/* Session details */}
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-md bg-white/[0.03] px-4 py-3.5 ring-1 ring-white/[0.06]">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-accent">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Host
                  </span>
                  <span className="text-sm font-medium text-text">{hostName}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-md bg-white/[0.03] px-4 py-3.5 ring-1 ring-white/[0.06]">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-accent">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <line x1="19" x2="19" y1="8" y2="14" />
                    <line x1="22" x2="16" y1="11" y2="11" />
                  </svg>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    {isHostRejoin ? "Rejoining as Host" : "You're joining as"}
                  </span>
                  <span className="text-sm font-medium text-text">{isHostRejoin ? hostName : guestName}</span>
                </div>
              </div>
            </div>

            {/* Info banner */}
            <div className="flex items-center gap-3 rounded-md bg-accent/[0.06] px-4 py-3 ring-1 ring-accent/10">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-accent/60">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
              <p className="text-xs text-text-muted">
                Audio-only session &middot; Your microphone will be used &middot; Up to 1 hour
              </p>
            </div>

            <Button
              variant="primary"
              size="lg"
              onClick={handleJoin}
              className="w-full"
            >
              {isHostRejoin ? "Rejoin as Host" : "Join Session"}
            </Button>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
