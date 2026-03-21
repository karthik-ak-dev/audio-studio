import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Loader } from "@/components/ui/Loader";
import { api } from "@/api/client";
import { getStoredEmail, getStoredName, clearStoredIdentity } from "@/pages/Landing";
import type { Session } from "@/types/session";
import type { Topic } from "@/types/topic";

interface TopicGroup {
  topic: Topic | null;
  sessions: Session[];
}

function groupSessionsByTopic(
  sessions: Session[],
  topics: Topic[],
): TopicGroup[] {
  const topicMap = new Map<string, Topic>();
  for (const t of topics) topicMap.set(t.topic_id, t);

  const grouped = new Map<string, Session[]>();
  const ungrouped: Session[] = [];

  for (const s of sessions) {
    if (s.topic_id) {
      const existing = grouped.get(s.topic_id) ?? [];
      existing.push(s);
      grouped.set(s.topic_id, existing);
    } else {
      ungrouped.push(s);
    }
  }

  const result: TopicGroup[] = [];
  for (const [topicId, topicSessions] of grouped) {
    result.push({
      topic: topicMap.get(topicId) ?? {
        topic_id: topicId,
        host_user_id: "",
        topic_name: topicSessions[0]?.topic_name ?? "Unknown Topic",
        created_at: "",
        updated_at: "",
      },
      sessions: topicSessions,
    });
  }

  if (ungrouped.length > 0) {
    result.push({ topic: null, sessions: ungrouped });
  }

  return result;
}

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

export function Dashboard() {
  const navigate = useNavigate();
  const userEmail = getStoredEmail();
  const userName = getStoredName();

  const [loading, setLoading] = useState(true);
  const [topicGroups, setTopicGroups] = useState<TopicGroup[]>([]);
  const [collapsedTopics, setCollapsedTopics] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userEmail) {
      navigate("/", { replace: true });
      return;
    }

    async function loadData() {
      try {
        const [hostRes, guestRes, topicsRes] = await Promise.all([
          api.getUserSessions(userEmail!).catch(() => ({ sessions: [] as Session[] })),
          api.getGuestSessions(userEmail!, 50).catch(() => ({ sessions: [] as Session[] })),
          api.getUserTopics(userEmail!).catch(() => ({ topics: [] as Topic[] })),
        ]);

        // Deduplicate sessions (in case same session appears in both)
        const sessionMap = new Map<string, Session>();
        for (const s of [...hostRes.sessions, ...guestRes.sessions]) {
          sessionMap.set(s.session_id, s);
        }
        const allSessions = Array.from(sessionMap.values());

        // Sort by created_at descending
        allSessions.sort((a, b) => b.created_at.localeCompare(a.created_at));

        const topics = topicsRes.topics;
        setTopicGroups(groupSessionsByTopic(allSessions, topics));
      } catch {
        // Silently handle errors
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [userEmail, navigate]);

  const toggleTopic = (key: string) => {
    setCollapsedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const copyTopicId = (topicId: string) => {
    navigator.clipboard.writeText(topicId);
  };

  const handleLogout = () => {
    clearStoredIdentity();
    navigate("/", { replace: true });
  };

  if (!userEmail || !userName) return null;

  const isActiveSession = (status: string) =>
    ["created", "waiting_for_guest", "ready", "recording", "paused"].includes(status);

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl animate-slide-up">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-text md:text-3xl">
              My <span className="text-gradient-accent">Recordings</span>
            </h1>
            <p className="mt-1 text-sm text-text-muted">{userEmail}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate("/session/new")}
            >
              + New Recording
            </Button>
            <button
              onClick={handleLogout}
              className="text-xs text-text-muted hover:text-text transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader size="lg" />
          </div>
        )}

        {/* Empty state */}
        {!loading && topicGroups.length === 0 && (
          <Card>
            <div className="py-12 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.04]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-text-muted">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              </div>
              <p className="text-sm text-text-muted">No recordings yet</p>
              <p className="mt-1 text-xs text-text-muted/70">
                Create your first recording session to get started.
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate("/session/new")}
                className="mt-4"
              >
                + New Recording
              </Button>
            </div>
          </Card>
        )}

        {/* Topic groups */}
        {!loading &&
          topicGroups.map((group) => {
            const key = group.topic?.topic_id ?? "__ungrouped__";
            const isCollapsed = collapsedTopics.has(key);

            return (
              <div key={key} className="mb-6">
                {/* Topic header */}
                <button
                  onClick={() => toggleTopic(key)}
                  className="mb-2 flex w-full items-center gap-2 text-left"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-3.5 w-3.5 text-text-muted transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span className="text-sm font-semibold text-text">
                    {group.topic ? group.topic.topic_name : "Ungrouped"}
                  </span>
                  <span className="text-xs text-text-muted">
                    ({group.sessions.length} session{group.sessions.length !== 1 ? "s" : ""})
                  </span>
                  {group.topic && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyTopicId(group.topic!.topic_id);
                      }}
                      className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-xs text-text-muted hover:bg-white/[0.04] hover:text-text transition-colors"
                      title="Copy Topic ID"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      ID
                    </button>
                  )}
                </button>

                {/* Session rows */}
                {!isCollapsed && (
                  <Card>
                    <div className="divide-y divide-white/[0.04]">
                      {group.sessions.map((session) => {
                        const otherPerson =
                          session.host_user_id === userEmail
                            ? session.guest_name
                            : session.host_name;
                        const role =
                          session.host_user_id === userEmail ? "Host" : "Guest";

                        return (
                          <div
                            key={session.session_id}
                            className="flex items-center gap-4 px-1 py-3 first:pt-0 last:pb-0"
                          >
                            <span className="min-w-[52px] text-xs text-text-muted">
                              {formatDate(session.created_at)}
                            </span>
                            <span className="flex-1 truncate text-sm text-text">
                              with {otherPerson}
                            </span>
                            <span className="text-xs text-text-muted">{role}</span>
                            {statusBadge(session.status)}
                            {isActiveSession(session.status) ? (
                              <Link
                                to={`/session/${session.session_id}`}
                                className="text-xs font-medium text-accent hover:underline"
                              >
                                Go
                              </Link>
                            ) : session.status === "completed" ? (
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
                        );
                      })}
                    </div>
                  </Card>
                )}
              </div>
            );
          })}
      </div>
    </PageContainer>
  );
}
