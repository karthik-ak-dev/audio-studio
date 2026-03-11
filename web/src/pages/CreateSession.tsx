import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useSessionApi } from "@/hooks/useSessionApi";
import { useSessionDispatch } from "@/context/SessionContext";

export function CreateSession() {
  const navigate = useNavigate();
  const dispatch = useSessionDispatch();
  const { loading, error, createSession, clearError } = useSessionApi();

  const [hostName, setHostName] = useState<string>("");
  const [guestName, setGuestName] = useState<string>("");

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearError();

    const result = await createSession({
      host_user_id: `host-${Date.now()}`,
      host_name: hostName.trim(),
      guest_name: guestName.trim(),
    });

    if (result) {
      dispatch({
        type: "SESSION_CREATED",
        payload: {
          sessionId: result.session_id,
          roomUrl: result.room_url,
          hostToken: result.host_token,
          guestJoinUrl: result.guest_join_url,
          hostName: hostName.trim(),
          guestName: guestName.trim(),
        },
      });
      navigate(`/session/${result.session_id}`);
    }
  };

  return (
    <PageContainer>
      <div className="mx-auto max-w-lg animate-slide-up">
        {/* Hero section */}
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
          <p className="mt-3 text-sm leading-relaxed text-text-muted">
            Start an audio recording session with a guest.
            <br className="hidden sm:block" />
            You'll get a shareable link after creating.
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="space-y-5">
              <Input
                label="Your Name"
                placeholder="Enter your name"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                required
                maxLength={64}
                autoFocus
              />

              <Input
                label="Guest Name"
                placeholder="Enter guest's name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                required
                maxLength={64}
              />
            </div>

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
              disabled={!hostName.trim() || !guestName.trim()}
              className="mt-1 w-full"
            >
              Create Session
            </Button>
          </form>
        </Card>

        {/* Feature hints */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {[
            { icon: "M19 10v2a7 7 0 0 1-14 0v-2", label: "Audio-only" },
            { icon: "M12 6v6l4 2", label: "Up to 1 hour" },
            { icon: "M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m6 16h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4", label: "Separate tracks" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-1.5 text-text-muted">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d={item.icon} />
              </svg>
              <span className="text-xs">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
