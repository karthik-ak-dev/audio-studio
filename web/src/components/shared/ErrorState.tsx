import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  centered?: boolean;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  centered = false,
}: ErrorStateProps) {
  const card = (
    <Card variant="default" className="mx-auto max-w-md text-center">
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6 text-red-400"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" x2="9" y1="9" y2="15" />
            <line x1="9" x2="15" y1="9" y2="15" />
          </svg>
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-text">{title}</h3>
          <p className="text-sm text-text-muted">{message}</p>
        </div>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try Again
          </Button>
        )}
      </div>
    </Card>
  );

  if (centered) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        {card}
      </div>
    );
  }

  return card;
}
