import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { Session, SessionStatus } from "@/types/session";

// ─── State ───────────────────────────────────────

interface SessionState {
  sessionId: string | null;
  roomUrl: string | null;
  token: string | null;
  guestJoinUrl: string | null;
  isHost: boolean;
  error: string | null;

  // Server-driven fields — updated from poll responses
  status: SessionStatus | null;
  hostName: string | null;
  guestName: string | null;
  hostUserId: string | null;
  participantCount: number;
  activeParticipants: string[];
  participantsRoster: Record<string, string>;
  recordingStartedAt: string | null;
  recordingStoppedAt: string | null;
  pauseEvents: Array<{ paused_at: string; resumed_at: string | null }>;
  s3Key: string | null;
  s3ProcessedPrefix: string | null;
  hostRejoinUrl: string | null;
  guestRejoinUrl: string | null;
  errorMessage: string | null;
  createdAt: string | null;
}

const initialState: SessionState = {
  sessionId: null,
  roomUrl: null,
  token: null,
  guestJoinUrl: null,
  isHost: false,
  error: null,
  status: null,
  hostName: null,
  guestName: null,
  hostUserId: null,
  participantCount: 0,
  activeParticipants: [],
  participantsRoster: {},
  createdAt: null,
  recordingStartedAt: null,
  recordingStoppedAt: null,
  pauseEvents: [],
  s3Key: null,
  s3ProcessedPrefix: null,
  hostRejoinUrl: null,
  guestRejoinUrl: null,
  errorMessage: null,
};

// ─── Actions ─────────────────────────────────────

type SessionAction =
  | {
      type: "SESSION_CREATED";
      payload: {
        sessionId: string;
        roomUrl: string;
        hostToken: string;
        guestJoinUrl: string;
        hostName: string;
        guestName: string;
        hostUserId: string;
      };
    }
  | {
      type: "SESSION_LOADED";
      payload: {
        sessionId: string;
        roomUrl: string;
        token: string;
        isHost: boolean;
      };
    }
  | { type: "SESSION_SYNCED"; payload: { session: Session } }
  | { type: "ERROR_OCCURRED"; payload: { error: string } }
  | { type: "SESSION_RESET" };

// ─── Reducer ─────────────────────────────────────

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "SESSION_CREATED":
      return {
        ...state,
        sessionId: action.payload.sessionId,
        roomUrl: action.payload.roomUrl,
        token: action.payload.hostToken,
        guestJoinUrl: action.payload.guestJoinUrl,
        hostName: action.payload.hostName,
        guestName: action.payload.guestName,
        hostUserId: action.payload.hostUserId,
        status: "created",
        isHost: true,
        error: null,
      };

    case "SESSION_LOADED":
      return {
        ...state,
        sessionId: action.payload.sessionId,
        roomUrl: action.payload.roomUrl,
        token: action.payload.token,
        isHost: action.payload.isHost,
        error: null,
      };

    case "SESSION_SYNCED": {
      const s = action.payload.session;
      return {
        ...state,
        status: s.status,
        hostName: s.host_name,
        guestName: s.guest_name,
        hostUserId: s.host_user_id,
        participantCount: s.participant_count,
        activeParticipants: s.active_participants,
        participantsRoster: s.participants,
        recordingStartedAt: s.recording_started_at,
        recordingStoppedAt: s.recording_stopped_at,
        pauseEvents: s.pause_events ?? [],
        s3Key: s.s3_key,
        s3ProcessedPrefix: s.s3_processed_prefix,
        hostRejoinUrl: s.host_rejoin_url,
        guestRejoinUrl: s.guest_rejoin_url,
        errorMessage: s.error_message,
        createdAt: s.created_at,
      };
    }

    case "ERROR_OCCURRED":
      return {
        ...state,
        error: action.payload.error,
      };

    case "SESSION_RESET":
      return initialState;

    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────

const SessionStateContext = createContext<SessionState | null>(null);
const SessionDispatchContext = createContext<Dispatch<SessionAction> | null>(null);

interface SessionProviderProps {
  children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);

  return (
    <SessionStateContext.Provider value={state}>
      <SessionDispatchContext.Provider value={dispatch}>
        {children}
      </SessionDispatchContext.Provider>
    </SessionStateContext.Provider>
  );
}

export function useSessionState(): SessionState {
  const context = useContext(SessionStateContext);
  if (context === null) {
    throw new Error("useSessionState must be used within SessionProvider");
  }
  return context;
}

export function useSessionDispatch(): Dispatch<SessionAction> {
  const context = useContext(SessionDispatchContext);
  if (context === null) {
    throw new Error("useSessionDispatch must be used within SessionProvider");
  }
  return context;
}
