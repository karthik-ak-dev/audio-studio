import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Loader } from "@/components/ui/Loader";
import { ErrorState } from "@/components/shared/ErrorState";
import { api } from "@/api/client";
import type { TopicWithSessions } from "@/types/topic";

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="accent">Completed</Badge>;
    case "recording":
      return <Badge variant="error">Recording</Badge>;
    case "paused":
      return <Badge variant="warning">Paused</Badge>;
    case "processing":
      return <Badge variant="warning">Processing</Badge>;
    case "error":
      return <Badge variant="error">Error</Badge>;
    case "cancelled":
      return <Badge variant="neutral">Cancelled</Badge>;
    default:
      return <Badge variant="neutral">{status.replace(/_/g, " ")}</Badge>;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

export function TopicSessions() {
  const { topicId } = useParams<{ topicId: string }>();
  const [data, setData] = useState<TopicWithSessions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!topicId) return;
    api
      .getTopic(topicId)
      .then(setData)
      .catch((err) => setError(err.detail ?? "Topic not found"))
      .finally(() => setLoading(false));
  }, [topicId]);

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-20">
          <Loader size="lg" />
        </div>
      </PageContainer>
    );
  }

  if (error || !data) {
    return (
      <PageContainer>
        <ErrorState title="Topic not found" message={error ?? "The topic you're looking for doesn't exist."} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl animate-slide-up">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs text-text-muted mb-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            Topic
          </div>
          <h1 className="text-2xl font-black tracking-tight text-text md:text-3xl">
            {data.topic.topic_name}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Created by {data.topic.host_user_id} &middot;{" "}
            {data.sessions.length} session{data.sessions.length !== 1 ? "s" : ""}
          </p>
        </div>

        {data.sessions.length === 0 ? (
          <Card>
            <div className="py-12 text-center">
              <p className="text-sm text-text-muted">No sessions yet for this topic.</p>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="divide-y divide-white/[0.04]">
              {data.sessions.map((session) => (
                <div
                  key={session.session_id}
                  className="flex items-center gap-4 px-1 py-3 first:pt-0 last:pb-0"
                >
                  <span className="min-w-[52px] text-xs text-text-muted">
                    {formatDate(session.created_at)}
                  </span>
                  <span className="flex-1 truncate text-sm text-text">
                    {session.host_name} & {session.guest_name}
                  </span>
                  {statusBadge(session.status)}
                  {session.status === "completed" ? (
                    <Link
                      to={`/session/${session.session_id}/complete`}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      View
                    </Link>
                  ) : session.status === "processing" ? (
                    <Link
                      to={`/session/${session.session_id}/complete`}
                      className="text-xs font-medium text-text-muted hover:underline"
                    >
                      View
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
