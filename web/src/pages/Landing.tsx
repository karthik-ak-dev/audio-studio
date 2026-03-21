import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

const EMAIL_KEY = "recstudio:user-email";
const NAME_KEY = "recstudio:user-name";

export function getStoredEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY);
}

export function getStoredName(): string | null {
  return localStorage.getItem(NAME_KEY);
}

export function clearStoredIdentity(): void {
  localStorage.removeItem(EMAIL_KEY);
  localStorage.removeItem(NAME_KEY);
}

export function Landing() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    if (!trimmedEmail || !trimmedName) return;

    localStorage.setItem(EMAIL_KEY, trimmedEmail);
    localStorage.setItem(NAME_KEY, trimmedName);
    navigate("/dashboard");
  };

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
            Welcome to <span className="text-gradient-accent">Audio Studio</span>
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">
            Record high-quality audio sessions with guests.
            <br className="hidden sm:block" />
            Enter your details to get started.
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="space-y-5">
              <Input
                label="Your Email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
              <Input
                label="Your Name"
                placeholder="Enter your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={64}
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={!email.trim() || !name.trim()}
              className="mt-1 w-full"
            >
              Continue
            </Button>
          </form>
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
