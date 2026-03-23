import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Loader } from "@/components/ui/Loader";
import { api } from "@/api/client";
import { getStoredEmail, getStoredName, clearStoredIdentity } from "@/pages/Landing";
import { SESSION_STATUS } from "@/types/session";
import type { Session } from "@/types/session";
import type { Recording } from "@/types/recording";

interface RecordingGroup {
  recording: Recording | null;
  sessions: Session[];
}

function groupSessionsByRecording(
  sessions: Session[],
  recordings: Recording[],
): RecordingGroup[] {
  const recordingMap = new Map<string, Recording>();
  for (const r of recordings) recordingMap.set(r.recording_id, r);

  const grouped = new Map<string, Session[]>();
  const standalone: Session[] = [];

  for (const s of sessions) {
    if (s.recording_id) {
      const existing = grouped.get(s.recording_id) ?? [];
      existing.push(s);
      grouped.set(s.recording_id, existing);
    } else {
      standalone.push(s);
    }
  }

  const result: RecordingGroup[] = [];
  for (const [recordingId, recSessions] of grouped) {
    result.push({
      recording: recordingMap.get(recordingId) ?? {
        recording_id: recordingId,
        host_user_id: "",
        host_name: "",
        guest_user_id: "",
        guest_name: recSessions[0]?.guest_name ?? "",
        recording_name: recSessions[0]?.recording_name ?? "Unknown Recording",
        created_at: "",
        updated_at: "",
      },
      sessions: recSessions,
    });
  }

  if (standalone.length > 0) {
    result.push({ recording: null, sessions: standalone });
  }

  return result;
}

function statusBadge(status: string) {
  switch (status) {
    case SESSION_STATUS.COMPLETED:
      return <Badge variant="accent">Completed</Badge>;
    case SESSION_STATUS.RECORDING:
      return <Badge variant="error">Recording</Badge>;
    case SESSION_STATUS.PAUSED:
      return <Badge variant="warning">Paused</Badge>;
    case SESSION_STATUS.PROCESSING:
      return <Badge variant="warning">Processing</Badge>;
    case SESSION_STATUS.ERROR:
      return <Badge variant="error">Error</Badge>;
    case SESSION_STATUS.CANCELLED:
      return <Badge variant="neutral">Cancelled</Badge>;
    default:
      return <Badge variant="neutral">{status.replace(/_/g, " ")}</Badge>;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

/** Reusable key-value row for session details */
function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted/60">{label}:</span>
      <span className="text-xs text-text">{children}</span>
    </div>
  );
}

function formatDatetime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-IN", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}

const ACTIVE_STATUSES: Set<string> = new Set([SESSION_STATUS.CREATED, SESSION_STATUS.WAITING_FOR_GUEST, SESSION_STATUS.READY, SESSION_STATUS.RECORDING, SESSION_STATUS.PAUSED]);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export function Dashboard() {
  const navigate = useNavigate();
  const userEmail = getStoredEmail();
  const userName = getStoredName();

  const [loading, setLoading] = useState(true);
  const [recordingGroups, setRecordingGroups] = useState<RecordingGroup[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userEmail) {
      navigate("/", { replace: true });
      return;
    }

    async function loadData() {
      try {
        const [hostSessions, guestSessions, hostRecordings, guestRecordings] = await Promise.all([
          api.getUserSessions(userEmail!).catch(() => ({ sessions: [] as Session[] })),
          api.getGuestSessions(userEmail!).catch(() => ({ sessions: [] as Session[] })),
          api.getHostRecordings(userEmail!).catch(() => ({ recordings: [] as Recording[] })),
          api.getGuestRecordings(userEmail!).catch(() => ({ recordings: [] as Recording[] })),
        ]);

        // Deduplicate sessions
        const sessionMap = new Map<string, Session>();
        for (const s of [...hostSessions.sessions, ...guestSessions.sessions]) {
          sessionMap.set(s.session_id, s);
        }
        const allSessions = Array.from(sessionMap.values());
        allSessions.sort((a, b) => b.created_at.localeCompare(a.created_at));

        // Deduplicate recordings
        const recMap = new Map<string, Recording>();
        for (const r of [...hostRecordings.recordings, ...guestRecordings.recordings]) {
          recMap.set(r.recording_id, r);
        }
        const allRecordings = Array.from(recMap.values());

        setRecordingGroups(groupSessionsByRecording(allSessions, allRecordings));
      } catch {
        // Silently handle errors
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [userEmail, navigate]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
  };

  const handleLogout = () => {
    clearStoredIdentity();
    navigate("/", { replace: true });
  };

  if (!userEmail || !userName) return null;

  return (
    <PageContainer>
      <div className="mx-auto max-w-5xl animate-slide-up">
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
              onClick={() => navigate("/recordings/new")}
            >
              + New Recording
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate("/session/new")}
            >
              Quick Session
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
        {!loading && recordingGroups.length === 0 && (
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
                Create your first recording to get started.
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate("/recordings/new")}
                className="mt-4"
              >
                + New Recording
              </Button>
            </div>
          </Card>
        )}

        {/* Recording groups */}
        {!loading &&
          recordingGroups.map((group) => {
            const key = group.recording?.recording_id ?? "__standalone__";
            const isCollapsed = collapsed.has(key);
            const isRecordingHost = group.recording?.host_user_id === userEmail;
            const withPerson = group.recording
              ? isRecordingHost
                ? `${group.recording.guest_name} (${group.recording.guest_user_id})`
                : `${group.recording.host_name} (${group.recording.host_user_id})`
              : null;

            return (
              <div key={key} className="mb-8">
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(key)}
                  className="mb-3 flex w-full items-center gap-2.5 text-left"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-4 w-4 text-text-muted transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span className="text-base font-semibold text-text">
                    {group.recording ? group.recording.recording_name : "Standalone Sessions"}
                  </span>
                  {withPerson && (
                    <span className="text-xs text-text-muted">
                      — with {withPerson}
                    </span>
                  )}
                  <span className="text-xs text-text-muted">
                    ({group.sessions.length} session{group.sessions.length !== 1 ? "s" : ""})
                  </span>
                </button>

                {/* Recording ID bar */}
                {group.recording && !isCollapsed && (
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted/60">Recording ID:</span>
                    <span className="font-mono text-xs text-text-muted">{group.recording.recording_id}</span>
                    <button
                      onClick={() => copyId(group.recording!.recording_id)}
                      className="flex items-center rounded p-1 text-text-muted/50 hover:bg-white/[0.04] hover:text-text transition-colors"
                      title="Copy Recording ID"
                    >
                      <CopyIcon />
                    </button>
                  </div>
                )}

                {/* Session cards + Add button */}
                {!isCollapsed && (
                  <div className="flex flex-col gap-3">
                    {/* Scrollable session list */}
                    <div className="flex flex-col gap-3 max-h-[480px] overflow-y-auto scrollbar-hide">
                      {group.sessions.map((session) => {
                        const isHost = session.host_user_id === userEmail;
                        return (
                          <Card key={session.session_id}>
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex flex-col gap-2">
                                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                                  <KV label="Session ID">
                                    <span className="font-mono">{session.session_id}</span>
                                  </KV>
                                  <KV label="Status">{statusBadge(session.status)}</KV>
                                  <KV label="Role">{isHost ? "Host" : "Guest"}</KV>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                                  {!group.recording && (
                                    <KV label={isHost ? "Guest" : "Host"}>
                                      {isHost ? session.guest_name : session.host_name}
                                    </KV>
                                  )}
                                  {session.recording_started_at && session.recording_stopped_at ? (
                                    <KV label="Recorded">
                                      {formatDatetime(session.recording_started_at)} — {formatTime(session.recording_stopped_at)}
                                    </KV>
                                  ) : session.recording_started_at ? (
                                    <KV label="Started">{formatDatetime(session.recording_started_at)}</KV>
                                  ) : (
                                    <KV label="Created">{formatDatetime(session.created_at)}</KV>
                                  )}
                                </div>
                              </div>

                              <div className="shrink-0 pt-0.5">
                                {ACTIVE_STATUSES.has(session.status) ? (
                                  <Link
                                    to={(() => {
                                      const url = isHost ? session.host_rejoin_url : session.guest_rejoin_url;
                                      if (!url) return `/session/${session.session_id}`;
                                      const parsed = new URL(url);
                                      return parsed.pathname + parsed.search;
                                    })()}
                                    className="rounded-md bg-accent/10 px-4 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 transition-colors"
                                  >
                                    Go
                                  </Link>
                                ) : session.status === SESSION_STATUS.COMPLETED || session.status === SESSION_STATUS.PROCESSING || session.status === SESSION_STATUS.ERROR || session.status === SESSION_STATUS.CANCELLED ? (
                                  <Link
                                    to={`/session/${session.session_id}/complete`}
                                    className="rounded-md bg-white/[0.04] px-4 py-1.5 text-xs font-semibold text-text-muted hover:bg-white/[0.08] transition-colors"
                                  >
                                    View
                                  </Link>
                                ) : null}
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                    </div>

                    {/* Fixed Add session button */}
                    {group.recording && group.recording.host_user_id === userEmail && (
                      <Link
                        to={`/session/new?recording_id=${group.recording.recording_id}`}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/[0.08] py-3 text-xs font-medium text-accent/70 hover:border-accent/30 hover:text-accent transition-colors"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                          <line x1="12" x2="12" y1="5" y2="19" />
                          <line x1="5" x2="19" y1="12" y2="12" />
                        </svg>
                        Add Session to this Recording
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </PageContainer>
  );
}
