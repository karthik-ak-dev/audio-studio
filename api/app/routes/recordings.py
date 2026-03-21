"""
Recording Routes — thin HTTP layer for recording management.

Endpoints:
  POST /recordings/                       → Create a new recording
  GET  /recordings/{recording_id}         → Get recording with its sessions
  GET  /recordings/host/{host_user_id}    → List recordings for a host
  GET  /recordings/guest/{guest_user_id}  → List recordings where user is a guest
"""

import logging

from fastapi import APIRouter, HTTPException

from app.types.requests import CreateRecordingRequest
from app.types.responses import RecordingResponse, RecordingWithSessionsResponse
from app.services.recording_service import RecordingNotFoundError
from app.services import recording_service

logger: logging.Logger = logging.getLogger(__name__)
router: APIRouter = APIRouter()


# ─── Recording CRUD ──────────────────────────────


@router.post("/", response_model=RecordingResponse, status_code=201)
async def create_recording(req: CreateRecordingRequest) -> RecordingResponse:
    """Create a new recording — a fixed host-guest pair with a name."""
    return await recording_service.create_recording(req)


@router.get("/{recording_id}", response_model=RecordingWithSessionsResponse)
async def get_recording(recording_id: str) -> RecordingWithSessionsResponse:
    """Get recording details with all its sessions."""
    try:
        return await recording_service.get_recording_with_sessions(recording_id)
    except RecordingNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Recording not found") from exc


# ─── Query ───────────────────────────────────────


@router.get("/host/{host_user_id}")
async def list_host_recordings(
    host_user_id: str, limit: int = 50,
) -> dict[str, list[RecordingResponse]]:
    """List recordings where user is the host, ordered by most recent first."""
    recordings = await recording_service.list_recordings_by_host(host_user_id, limit=limit)
    return {"recordings": recordings}


@router.get("/guest/{guest_user_id}")
async def list_guest_recordings(
    guest_user_id: str, limit: int = 50,
) -> dict[str, list[RecordingResponse]]:
    """List recordings where user is a guest, ordered by most recent first."""
    recordings = await recording_service.list_recordings_by_guest(guest_user_id, limit=limit)
    return {"recordings": recordings}
