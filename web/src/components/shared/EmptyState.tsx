import { type ReactNode } from "react";
import { Card } from "@/components/ui/Card";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <Card variant="default" className="mx-auto max-w-md text-center">
      <div className="flex flex-col items-center gap-4 py-8">
        {icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
            {icon}
          </div>
        )}
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-text">{title}</h3>
          <p className="text-sm text-text-muted">{message}</p>
        </div>
        {action}
      </div>
    </Card>
  );
}
