import { API_BASE_URL } from "@/config/constants";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  Session,
  SessionActionResponse,
} from "@/types/session";

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

export const api = {
  createSession(data: CreateSessionRequest): Promise<CreateSessionResponse> {
    return request<CreateSessionResponse>("/sessions/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  getSession(sessionId: string): Promise<Session> {
    return request<Session>(`/sessions/${sessionId}`);
  },

  stopSession(sessionId: string): Promise<SessionActionResponse> {
    return request<SessionActionResponse>(`/sessions/${sessionId}/stop`, {
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
} as const;

export { ApiError };
