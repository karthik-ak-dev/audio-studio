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
      <div className="mx-auto max-w-md animate-slide-up">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-black tracking-tight text-text md:text-4xl">
            New <span className="text-gradient-accent">Session</span>
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            Create an audio recording session for two participants
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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

            {error && (
              <div className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              disabled={!hostName.trim() || !guestName.trim()}
              className="mt-2 w-full"
            >
              Create Session
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-text-muted">
          Audio-only recording &middot; Up to 1 hour &middot; 48kHz WAV output
        </p>
      </div>
    </PageContainer>
  );
}
