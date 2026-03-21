import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useSessionApi } from "@/hooks/useSessionApi";
import { useSessionDispatch } from "@/context/SessionContext";
import { api } from "@/api/client";
import { getStoredEmail, getStoredName } from "@/pages/Landing";
import { nameFromEmail } from "@/utils/identity";
import type { Recording } from "@/types/recording";

const STORAGE_PREFIX = "recstudio:";

export function CreateSession() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dispatch = useSessionDispatch();
  const { loading, error, createSession, clearError } = useSessionApi();

  const userEmail = getStoredEmail();
  const hostName = getStoredName() ?? "";

  useEffect(() => {
    if (!userEmail) {
      navigate("/", { replace: true });
    }
  }, [userEmail, navigate]);

  const [guestEmail, setGuestEmail] = useState("");

  // Recording context — pre-filled when recording_id is in URL
  const recordingIdParam = searchParams.get("recording_id");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [recordingLoading, setRecordingLoading] = useState(!!recordingIdParam);

  useEffect(() => {
    if (!recordingIdParam) return;
    setRecordingLoading(true);
    api
      .getRecording(recordingIdParam)
      .then((res) => {
        setRecording(res.recording);
        setGuestEmail(res.recording.guest_user_id);
      })
      .catch(() => setRecording(null))
      .finally(() => setRecordingLoading(false));
  }, [recordingIdParam]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearError();
    if (!userEmail) return;

    const trimmedGuestEmail = recording
      ? recording.guest_user_id
      : guestEmail.trim().toLowerCase();
    const guestName = recording
      ? recording.guest_name
      : nameFromEmail(trimmedGuestEmail);

    const result = await createSession({
      host_user_id: userEmail,
      host_name: hostName,
      guest_name: guestName,
      guest_user_id: trimmedGuestEmail || undefined,
      recording_id: recording?.recording_id,
    });

    if (result) {
      sessionStorage.setItem(
        `${STORAGE_PREFIX}${result.session_id}`,
        JSON.stringify({
          token: result.host_token,
          isHost: true,
          roomUrl: result.room_url,
          guestJoinUrl: result.guest_join_url,
        }),
      );

      dispatch({
        type: "SESSION_CREATED",
        payload: {
          sessionId: result.session_id,
          roomUrl: result.room_url,
          hostToken: result.host_token,
          guestJoinUrl: result.guest_join_url,
          hostName,
          guestName,
          hostUserId: userEmail,
        },
      });
      navigate(`/session/${result.session_id}`);
    }
  };

  if (!userEmail) return null;

  const isRecordingMode = !!recording;

  return (
    <PageContainer>
      <div className="mx-auto max-w-lg animate-slide-up">
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
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-text md:text-4xl">
            New <span className="text-gradient-accent">Session</span>
          </h1>
          {isRecordingMode ? (
            <p className="mt-3 text-sm leading-relaxed text-text-muted">
              Adding to: <span className="text-text font-medium">{recording.recording_name}</span>
            </p>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-text-muted">
              Quick standalone recording session.
            </p>
          )}
        </div>

        <Card>
          {recordingLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              {/* Host identity (read-only) */}
              <div className="flex items-center gap-3 rounded-md bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06]">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">
                  {hostName.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-text">{hostName}</span>
                  <span className="text-xs text-text-muted">{userEmail}</span>
                </div>
                <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-text-muted">Host</span>
              </div>

              <Input
                label="Guest Email"
                type="email"
                placeholder="guest@example.com"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                required={!isRecordingMode}
                disabled={isRecordingMode}
                className={isRecordingMode ? "opacity-60" : ""}
                autoFocus={!isRecordingMode}
              />

              {error && (
                <div className="flex items-start gap-3 rounded-md bg-red-500/10 px-4 py-3 ring-1 ring-red-500/20">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0 text-red-400">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm text-red-400">{error}</span>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={loading}
                disabled={!isRecordingMode && !guestEmail.trim()}
                className="mt-1 w-full"
              >
                Create Session
              </Button>
            </form>
          )}
        </Card>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-1.5 text-text-muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
            <span className="text-xs">Audio-only</span>
          </div>
          <div className="flex items-center gap-1.5 text-text-muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="text-xs">Up to 1 hour</span>
          </div>
          <div className="flex items-center gap-1.5 text-text-muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <rect x="1" y="4" width="8" height="16" rx="1" />
              <rect x="15" y="4" width="8" height="16" rx="1" />
            </svg>
            <span className="text-xs">Separate tracks</span>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
