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
  POST /sessions/{session_id}/end    → Host ends session → processing (TERMINAL)
  POST /sessions/{session_id}/cancel → Cancel completed session (quality issue)
  POST /sessions/{session_id}/pause  → Host pauses recording
  POST /sessions/{session_id}/resume → Host resumes recording (new segment)
  GET  /sessions/user/{host_user_id} → List sessions for a host
"""

import logging

from fastapi import APIRouter, HTTPException

from app.types.requests import CreateSessionRequest, JoinRequest, LeaveRequest, CancelSessionRequest
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

logger: logging.Logger = logging.getLogger(__name__)
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
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc


# ─── Participant lifecycle (FE-driven) ────────────
# Called by the frontend when daily-js reports join/leave events.
# Join is BLOCKING (FE waits for response before updating UI).
# Leave fires when user explicitly clicks "Leave Session".
# Webhooks from Daily.co act as a safety net if these calls are missed.


@router.post("/{session_id}/join", response_model=SessionActionResponse)
async def join_session(session_id: str, req: JoinRequest) -> SessionActionResponse:
    """FE reports: participant joined the Daily.co room."""
    try:
        return await session_service.join_session(session_id, req)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc


@router.post("/{session_id}/leave", response_model=SessionActionResponse)
async def leave_session(session_id: str, req: LeaveRequest) -> SessionActionResponse:
    """FE reports: participant left the Daily.co room."""
    try:
        return await session_service.leave_session(session_id, req)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc


# ─── Recording controls (host-only, FE-driven) ───
# These endpoints call the Daily.co REST API to control recording,
# then immediately update DynamoDB. The FE waits for the response
# before updating its local UI state.


@router.post("/{session_id}/start", response_model=SessionActionResponse)
async def start_recording(session_id: str) -> SessionActionResponse:
    """Host starts recording. Calls Daily.co start_recording API."""
    try:
        return await session_service.start_recording(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc
    except InvalidSessionStateError as exc:
        logger.warning("Start recording rejected: session=%s — %s", session_id, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{session_id}/end", response_model=SessionActionResponse)
async def end_session(session_id: str) -> SessionActionResponse:
    """Host ends session. Moves to processing. ONLY terminal user action."""
    try:
        return await session_service.end_session(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc
    except InvalidSessionStateError as exc:
        logger.warning("End session rejected: session=%s — %s", session_id, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{session_id}/cancel", response_model=SessionActionResponse)
async def cancel_session(session_id: str, req: CancelSessionRequest) -> SessionActionResponse:
    """Cancel a completed session due to quality issues."""
    try:
        return await session_service.cancel_session(session_id, req.reason)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc
    except InvalidSessionStateError as exc:
        logger.warning("Cancel rejected: session=%s — %s", session_id, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{session_id}/pause", response_model=SessionActionResponse)
async def pause_session(session_id: str) -> SessionActionResponse:
    """Host pauses recording. Stops the current recording segment."""
    try:
        return await session_service.pause_session(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc
    except InvalidSessionStateError as exc:
        logger.warning("Pause rejected: session=%s — %s", session_id, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{session_id}/resume", response_model=SessionActionResponse)
async def resume_session(session_id: str) -> SessionActionResponse:
    """Host resumes recording. Starts a new recording segment."""
    try:
        return await session_service.resume_session(session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc
    except InvalidSessionStateError as exc:
        logger.warning("Resume rejected: session=%s — %s", session_id, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ─── Query ────────────────────────────────────────


@router.get("/user/{host_user_id}")
async def list_user_sessions(
    host_user_id: str, limit: int = 20,
) -> dict[str, list[SessionResponse]]:
    """List sessions for a host user, ordered by most recent first."""
    sessions = await session_service.list_sessions_by_host(
        host_user_id, limit=limit,
    )
    return {"sessions": sessions}


@router.get("/guest/{guest_user_id}")
async def list_guest_sessions(
    guest_user_id: str, limit: int = 20,
) -> dict[str, list[SessionResponse]]:
    """List sessions where user was a guest, ordered by most recent first."""
    sessions = await session_service.list_sessions_by_guest(
        guest_user_id, limit=limit,
    )
    return {"sessions": sessions}
