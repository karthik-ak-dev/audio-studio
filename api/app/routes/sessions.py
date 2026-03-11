"""
Session Routes — thin HTTP layer.

This file is intentionally thin. It only handles:
  1. HTTP request/response mapping
  2. Error → HTTP status code translation
  3. Delegation to session_service for all business logic

No business logic, no DynamoDB calls, no Daily.co calls here.

Endpoints:
  POST /sessions/                    → Create a new session (room + tokens)
  GET  /sessions/{session_id}        → Get session status and metadata
  POST /sessions/{session_id}/join   → FE reports: participant joined the room
  POST /sessions/{session_id}/leave  → FE reports: participant left the room
  POST /sessions/{session_id}/start  → Host starts recording
  POST /sessions/{session_id}/stop   → Host stops recording → processing
  POST /sessions/{session_id}/pause  → Host pauses recording
  POST /sessions/{session_id}/resume → Host resumes recording (new segment)
  GET  /sessions/user/{host_user_id} → List sessions for a host
"""

from fastapi import APIRouter, HTTPException

from app.types.requests import CreateSessionRequest
from app.types.responses import (
    CreateSessionResponse,
    SessionActionResponse,
    SessionResponse,
)
from app.services.session_service import (
    SessionNotFoundError,
    InvalidSessionStateError,
)
from app.services import session_service

router: APIRouter = APIRouter()


# ─── Session CRUD ─────────────────────────────────


@router.post("/", response_model=CreateSessionResponse, status_code=201)
async def create_session(req: CreateSessionRequest) -> CreateSessionResponse:
    """Create a new recording session with Daily room and tokens."""
    return await session_service.create_session(req)


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str) -> SessionResponse:
    """Get session status and metadata."""
    try:
        return await session_service.get_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")


# ─── Participant lifecycle (FE-driven) ────────────
# Called by the frontend when daily-js reports join/leave events.
# These are fire-and-forget from the FE side — failures don't block the UI.
# Webhooks from Daily.co act as a safety net if these calls are missed.


@router.post("/{session_id}/join", response_model=SessionActionResponse)
async def join_session(session_id: str) -> SessionActionResponse:
    """FE reports: participant joined the Daily.co room."""
    try:
        return await session_service.join_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")


@router.post("/{session_id}/leave", response_model=SessionActionResponse)
async def leave_session(session_id: str) -> SessionActionResponse:
    """FE reports: participant left the Daily.co room."""
    try:
        return await session_service.leave_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")


# ─── Recording controls (host-only, FE-driven) ───
# These endpoints call the Daily.co REST API to control recording,
# then immediately update DynamoDB. The FE waits for the response
# before updating its local UI state.


@router.post("/{session_id}/start", response_model=SessionActionResponse)
async def start_recording(session_id: str) -> SessionActionResponse:
    """Host starts recording. Calls Daily.co start_recording API."""
    try:
        return await session_service.start_recording(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except InvalidSessionStateError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{session_id}/stop", response_model=SessionActionResponse)
async def stop_session(session_id: str) -> SessionActionResponse:
    """Host stops recording. Moves session to processing."""
    try:
        return await session_service.stop_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except InvalidSessionStateError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{session_id}/pause", response_model=SessionActionResponse)
async def pause_session(session_id: str) -> SessionActionResponse:
    """Host pauses recording. Stops the current recording segment."""
    try:
        return await session_service.pause_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except InvalidSessionStateError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{session_id}/resume", response_model=SessionActionResponse)
async def resume_session(session_id: str) -> SessionActionResponse:
    """Host resumes recording. Starts a new recording segment."""
    try:
        return await session_service.resume_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except InvalidSessionStateError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── Query ────────────────────────────────────────


@router.get("/user/{host_user_id}")
async def list_user_sessions(host_user_id: str, limit: int = 20) -> dict[str, list[SessionResponse]]:
    """List sessions for a host user, ordered by most recent first."""
    sessions: list[SessionResponse] = await session_service.list_sessions_by_host(host_user_id, limit=limit)
    return {"sessions": sessions}
