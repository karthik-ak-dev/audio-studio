"""Session management endpoints — thin route layer, delegates to service."""

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


@router.post("/{session_id}/stop", response_model=SessionActionResponse)
async def stop_session(session_id: str) -> SessionActionResponse:
    """Stop recording and end the session."""
    try:
        return await session_service.stop_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except InvalidSessionStateError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{session_id}/pause", response_model=SessionActionResponse)
async def pause_session(session_id: str) -> SessionActionResponse:
    """Pause recording (stop + restart creates new segment on resume)."""
    try:
        return await session_service.pause_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except InvalidSessionStateError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{session_id}/resume", response_model=SessionActionResponse)
async def resume_session(session_id: str) -> SessionActionResponse:
    """Resume a paused recording (starts new recording segment)."""
    try:
        return await session_service.resume_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except InvalidSessionStateError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/user/{host_user_id}")
async def list_user_sessions(host_user_id: str, limit: int = 20) -> dict[str, list[SessionResponse]]:
    """List sessions for a host user."""
    sessions: list[SessionResponse] = await session_service.list_sessions_by_host(host_user_id, limit=limit)
    return {"sessions": sessions}
