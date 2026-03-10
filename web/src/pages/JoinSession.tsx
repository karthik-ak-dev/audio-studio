import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageLoader } from "@/components/ui/Loader";
import { ErrorState } from "@/components/shared/ErrorState";
import { useSessionApi } from "@/hooks/useSessionApi";
import { useSessionDispatch } from "@/context/SessionContext";

export function JoinSession() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useSessionDispatch();
  const { loading, error, getSession } = useSessionApi();

  const [sessionLoaded, setSessionLoaded] = useState<boolean>(false);
  const [hostName, setHostName] = useState<string>("");
  const [guestName, setGuestName] = useState<string>("");

  const token = searchParams.get("t");

  useEffect(() => {
    if (!sessionId) return;

    const loadSession = async () => {
      const session = await getSession(sessionId);
      if (session) {
        setHostName(session.host_name);
        setGuestName(session.guest_name);
        setSessionLoaded(true);
      }
    };

    void loadSession();
  }, [sessionId, getSession]);

  const handleJoin = () => {
    if (!sessionId || !token) return;

    dispatch({
      type: "SESSION_JOINED",
      payload: {
        sessionId,
        roomUrl: "", // Will be resolved from session
        token,
        hostName,
        guestName,
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
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mx-auto max-w-md animate-slide-up">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-black tracking-tight text-text md:text-4xl">
            Join <span className="text-gradient-accent">Session</span>
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            You&apos;ve been invited to an audio recording session
          </p>
        </div>

        <Card>
          <div className="flex flex-col gap-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md bg-white/[0.03] px-4 py-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Host
                </span>
                <span className="text-sm font-medium text-text">{hostName}</span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-white/[0.03] px-4 py-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Guest
                </span>
                <span className="text-sm font-medium text-text">{guestName}</span>
              </div>
            </div>

            <div className="rounded-md bg-accent/[0.06] px-4 py-3 text-center">
              <p className="text-xs text-text-muted">
                Audio-only &middot; Your microphone will be used &middot; Up to 1 hour
              </p>
            </div>

            <Button
              variant="primary"
              size="lg"
              onClick={handleJoin}
              className="w-full"
            >
              Join Session
            </Button>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
