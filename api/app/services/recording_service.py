"""Recording Service — business logic for recording management.

A Recording is a fixed host-guest relationship with a name. Multiple sessions
can be created under it. This service handles CRUD operations for recordings.

Architecture:
  Routes (thin HTTP layer) → Service (this file) → Repo (DynamoDB CRUD)
"""

import uuid
import logging

from app.constants import RECORDING_ID_LENGTH
from app.models.recording import Recording
from app.repos import recording_repo
from app.utils.identity import name_from_email
from app.repos import session_repo
from app.types.requests import CreateRecordingRequest
from app.types.responses import RecordingResponse, RecordingWithSessionsResponse, SessionResponse
from app.utils.time import now_iso

logger: logging.Logger = logging.getLogger(__name__)


def _generate_recording_id() -> str:
    return uuid.uuid4().hex[:RECORDING_ID_LENGTH]


def _to_recording_response(recording: Recording) -> RecordingResponse:
    return RecordingResponse(
        recording_id=recording.recording_id,
        host_user_id=recording.host_user_id,
        host_name=recording.host_name,
        guest_user_id=recording.guest_user_id,
        guest_name=recording.guest_name,
        recording_name=recording.recording_name,
        created_at=recording.created_at,
        updated_at=recording.updated_at,
    )


async def create_recording(req: CreateRecordingRequest) -> RecordingResponse:
    """Create a new recording — a fixed host-guest pair with a name."""
    recording_id: str = _generate_recording_id()
    now: str = now_iso()

    recording: Recording = Recording(
        recording_id=recording_id,
        host_user_id=req.host_user_id,
        host_name=req.host_name or name_from_email(req.host_user_id),
        guest_user_id=req.guest_user_id,
        guest_name=req.guest_name or name_from_email(req.guest_user_id),
        recording_name=req.recording_name,
        created_at=now,
        updated_at=now,
    )
    recording_repo.create(recording)

    logger.info(
        "Recording created: id=%s name=%s host=%s guest=%s",
        recording_id, req.recording_name, req.host_user_id, req.guest_user_id,
    )
    return _to_recording_response(recording)


async def get_recording(recording_id: str) -> RecordingResponse:
    """Retrieve a recording by ID."""
    recording: Recording | None = recording_repo.get_by_id(recording_id)
    if recording is None:
        raise RecordingNotFoundError(recording_id)
    return _to_recording_response(recording)


async def get_recording_with_sessions(recording_id: str) -> RecordingWithSessionsResponse:
    """Retrieve a recording and all sessions assigned to it."""
    from app.services.session_service import _to_session_response

    recording: Recording | None = recording_repo.get_by_id(recording_id)
    if recording is None:
        raise RecordingNotFoundError(recording_id)

    sessions = session_repo.get_by_recording(recording_id)
    session_responses: list[SessionResponse] = [_to_session_response(s) for s in sessions]

    return RecordingWithSessionsResponse(
        recording=_to_recording_response(recording),
        sessions=session_responses,
    )


async def list_recordings_by_host(host_user_id: str, limit: int = 50) -> list[RecordingResponse]:
    """List recordings for a given host user, ordered by most recent first."""
    recordings: list[Recording] = recording_repo.get_by_host(host_user_id, limit=limit)
    return [_to_recording_response(r) for r in recordings]


async def list_recordings_by_guest(
    guest_user_id: str, limit: int = 50,
) -> list[RecordingResponse]:
    """List recordings where user is a guest, ordered by most recent first."""
    recordings: list[Recording] = recording_repo.get_by_guest(guest_user_id, limit=limit)
    return [_to_recording_response(r) for r in recordings]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Exceptions
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class RecordingNotFoundError(Exception):
    """Raised when a recording_id does not exist in DynamoDB."""

    def __init__(self, recording_id: str) -> None:
        self.recording_id: str = recording_id
        super().__init__(f"Recording not found: {recording_id}")
