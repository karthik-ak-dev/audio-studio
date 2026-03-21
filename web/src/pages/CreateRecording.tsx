import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { api } from "@/api/client";
import { getStoredEmail, getStoredName } from "@/pages/Landing";
import { nameFromEmail } from "@/utils/identity";

export function CreateRecording() {
  const navigate = useNavigate();
  const userEmail = getStoredEmail();
  const userName = getStoredName();

  useEffect(() => {
    if (!userEmail) {
      navigate("/", { replace: true });
    }
  }, [userEmail, navigate]);

  const [recordingName, setRecordingName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userEmail || !userName) return;

    const trimmedGuestEmail = guestEmail.trim().toLowerCase();

    setLoading(true);
    setError(null);
    try {
      const recording = await api.createRecording({
        host_user_id: userEmail,
        host_name: userName,
        guest_user_id: trimmedGuestEmail,
        guest_name: nameFromEmail(trimmedGuestEmail),
        recording_name: recordingName.trim(),
      });
      navigate(`/session/new?recording_id=${recording.recording_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create recording");
    } finally {
      setLoading(false);
    }
  };

  if (!userEmail) return null;

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
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-text md:text-4xl">
            New <span className="text-gradient-accent">Recording</span>
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">
            Set up a recording with a guest. You can add
            <br className="hidden sm:block" />
            multiple sessions to it later.
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="space-y-5">
              <Input
                label="Recording Name"
                placeholder="e.g. Ticket Booking, Interview Prep"
                value={recordingName}
                onChange={(e) => setRecordingName(e.target.value)}
                required
                maxLength={128}
                autoFocus
              />

              <Input
                label="Guest Email"
                type="email"
                placeholder="guest@example.com"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                required
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
              disabled={!recordingName.trim() || !guestEmail.trim()}
              className="mt-1 w-full"
            >
              Create Recording
            </Button>
          </form>
        </Card>
      </div>
    </PageContainer>
  );
}
