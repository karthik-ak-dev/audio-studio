import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { SessionStatus } from "@/types/session";

// ─── State ───────────────────────────────────────

interface SessionState {
  sessionId: string | null;
  roomUrl: string | null;
  token: string | null;
  guestJoinUrl: string | null;
  status: SessionStatus | null;
  hostName: string | null;
  guestName: string | null;
  isHost: boolean;
  error: string | null;
}

const initialState: SessionState = {
  sessionId: null,
  roomUrl: null,
  token: null,
  guestJoinUrl: null,
  status: null,
  hostName: null,
  guestName: null,
  isHost: false,
  error: null,
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
      };
    }
  | {
      type: "SESSION_JOINED";
      payload: {
        sessionId: string;
        roomUrl: string;
        token: string;
        hostName: string;
        guestName: string;
      };
    }
  | { type: "STATUS_UPDATED"; payload: { status: SessionStatus } }
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
        status: "created",
        isHost: true,
        error: null,
      };
    case "SESSION_JOINED":
      return {
        ...state,
        sessionId: action.payload.sessionId,
        roomUrl: action.payload.roomUrl,
        token: action.payload.token,
        hostName: action.payload.hostName,
        guestName: action.payload.guestName,
        status: "created",
        isHost: false,
        error: null,
      };
    case "STATUS_UPDATED":
      return {
        ...state,
        status: action.payload.status,
      };
    case "ERROR_OCCURRED":
      return {
        ...state,
        status: "error",
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
