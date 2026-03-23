import { API_BASE_URL } from "@/config/constants";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  Session,
  SessionActionResponse,
} from "@/types/session";
import type {
  Recording,
  CreateRecordingRequest,
  RecordingWithSessions,
} from "@/types/recording";

class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: "Request failed" }));
    throw new ApiError(
      response.status,
      (body as { detail?: string }).detail ?? "Request failed",
    );
  }

  return response.json() as Promise<T>;
}

export interface JoinSessionBody {
  user_id: string;
  connection_id: string;
  user_name: string;
}

export interface LeaveSessionBody {
  user_id: string;
}

export const api = {
  // ─── Sessions ─────────────────────────────────

  createSession(data: CreateSessionRequest): Promise<CreateSessionResponse> {
    return request<CreateSessionResponse>("/sessions/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  getSession(sessionId: string): Promise<Session> {
    return request<Session>(`/sessions/${sessionId}`);
  },

  getUserSessions(hostUserId: string, limit = 50): Promise<{ sessions: Session[] }> {
    return request<{ sessions: Session[] }>(
      `/sessions/user/${encodeURIComponent(hostUserId)}?limit=${limit}`,
    );
  },

  getGuestSessions(guestUserId: string, limit = 50): Promise<{ sessions: Session[] }> {
    return request<{ sessions: Session[] }>(
      `/sessions/guest/${encodeURIComponent(guestUserId)}?limit=${limit}`,
    );
  },

  joinSession(sessionId: string, body: JoinSessionBody): Promise<SessionActionResponse> {
    return request<SessionActionResponse>(`/sessions/${sessionId}/join`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  leaveSession(sessionId: string, body: LeaveSessionBody): Promise<SessionActionResponse> {
    return request<SessionActionResponse>(`/sessions/${sessionId}/leave`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  startRecording(sessionId: string): Promise<SessionActionResponse> {
    return request<SessionActionResponse>(`/sessions/${sessionId}/start`, {
      method: "POST",
    });
  },

  endSession(sessionId: string): Promise<SessionActionResponse> {
    return request<SessionActionResponse>(`/sessions/${sessionId}/end`, {
      method: "POST",
    });
  },

  pauseSession(sessionId: string): Promise<SessionActionResponse> {
    return request<SessionActionResponse>(`/sessions/${sessionId}/pause`, {
      method: "POST",
    });
  },

  resumeSession(sessionId: string): Promise<SessionActionResponse> {
    return request<SessionActionResponse>(`/sessions/${sessionId}/resume`, {
      method: "POST",
    });
  },

  cancelSession(sessionId: string, body: { host_user_id: string; reason: string }): Promise<SessionActionResponse> {
    return request<SessionActionResponse>(`/sessions/${sessionId}/cancel`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  // ─── Recordings ─────────────────────────────────

  createRecording(data: CreateRecordingRequest): Promise<Recording> {
    return request<Recording>("/recordings/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  getRecording(recordingId: string): Promise<RecordingWithSessions> {
    return request<RecordingWithSessions>(`/recordings/${recordingId}`);
  },

  getHostRecordings(hostUserId: string, limit = 50): Promise<{ recordings: Recording[] }> {
    return request<{ recordings: Recording[] }>(
      `/recordings/host/${encodeURIComponent(hostUserId)}?limit=${limit}`,
    );
  },

  getGuestRecordings(guestUserId: string, limit = 50): Promise<{ recordings: Recording[] }> {
    return request<{ recordings: Recording[] }>(
      `/recordings/guest/${encodeURIComponent(guestUserId)}?limit=${limit}`,
    );
  },
} as const;

export { ApiError };
