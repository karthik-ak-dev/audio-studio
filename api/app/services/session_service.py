"""Session business logic — orchestrates repos, Daily client, and models."""

import uuid
import logging

from app.constants import SessionStatus, SESSION_ID_LENGTH
from app.models.session import Session
from app.repos import session_repo
from app.services.daily_client import daily_client
from app.types.requests import CreateSessionRequest
from app.types.responses import (
    CreateSessionResponse,
    SessionResponse,
    SessionActionResponse,
)
from app.utils.time import now_iso, compute_ttl

logger: logging.Logger = logging.getLogger(__name__)


def _generate_session_id() -> str:
    return uuid.uuid4().hex[:SESSION_ID_LENGTH]


async def create_session(req: CreateSessionRequest) -> CreateSessionResponse:
    """Create a Daily room, generate tokens, persist session to DynamoDB."""
    session_id: str = _generate_session_id()

    room: dict[str, object] = await daily_client.create_room(session_id)
    room_name: str = str(room["name"])
    room_url: str = str(room["url"])

    host_token: str = await daily_client.create_token(
        room_name=room_name,
        user_id=req.host_user_id,
        user_name=req.host_name,
        is_owner=True,
    )
    guest_token: str = await daily_client.create_token(
        room_name=room_name,
        user_id=f"guest-{session_id}",
        user_name=req.guest_name,
        is_owner=False,
    )

    now: str = now_iso()
    session: Session = Session(
        session_id=session_id,
        host_user_id=req.host_user_id,
        host_name=req.host_name,
        guest_name=req.guest_name,
        daily_room_name=room_name,
        daily_room_url=room_url,
        status=SessionStatus.CREATED,
        created_at=now,
        updated_at=now,
        ttl=compute_ttl(),
    )
    session_repo.create(session)

    return CreateSessionResponse(
        session_id=session_id,
        room_url=room_url,
        host_token=host_token,
        guest_token=guest_token,
        guest_join_url=f"{room_url}?t={guest_token}",
    )


async def get_session(session_id: str) -> SessionResponse:
    """Retrieve session by ID and return as response type."""
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)
    return _to_session_response(session)


async def stop_session(session_id: str) -> SessionActionResponse:
    """Stop recording and transition session to STOPPING."""
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    if session.status not in (SessionStatus.RECORDING, SessionStatus.PAUSED):
        raise InvalidSessionStateError(session_id, session.status, "stop")

    await daily_client.stop_recording(session.daily_room_name)
    session_repo.update_status(session_id, SessionStatus.STOPPING)
    return SessionActionResponse(session_id=session_id, status=SessionStatus.STOPPING)


async def pause_session(session_id: str) -> SessionActionResponse:
    """Pause recording by stopping it (resume creates a new segment)."""
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    if session.status != SessionStatus.RECORDING:
        raise InvalidSessionStateError(session_id, session.status, "pause")

    await daily_client.stop_recording(session.daily_room_name)
    session_repo.update_status(session_id, SessionStatus.PAUSED)
    return SessionActionResponse(session_id=session_id, status=SessionStatus.PAUSED)


async def resume_session(session_id: str) -> SessionActionResponse:
    """Resume a paused recording by starting a new recording segment."""
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    if session.status != SessionStatus.PAUSED:
        raise InvalidSessionStateError(session_id, session.status, "resume")

    await daily_client.start_recording(session.daily_room_name)
    new_count: int = session.recording_segments + 1
    session_repo.update_status(
        session_id, SessionStatus.RECORDING, recording_segments=str(new_count)
    )
    return SessionActionResponse(session_id=session_id, status=SessionStatus.RECORDING)


async def list_sessions_by_host(host_user_id: str, limit: int = 20) -> list[SessionResponse]:
    """List sessions for a given host user."""
    sessions: list[Session] = session_repo.get_by_host(host_user_id, limit=limit)
    return [_to_session_response(s) for s in sessions]


# ─── Webhook event handlers ──────────────────────

async def on_participant_joined(session_id: str, room_name: str) -> None:
    """Handle participant.joined webhook — auto-start recording when 2 present."""
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        logger.warning("Session not found for webhook: %s", session_id)
        return

    count: int = session_repo.increment_participant_count(session_id, 1)

    if count == 2 and session.status in (SessionStatus.CREATED, SessionStatus.WAITING_FOR_GUEST):
        logger.info("Both participants present — starting recording: %s", session_id)
        try:
            result: dict[str, object] = await daily_client.start_recording(room_name)
            session_repo.update_status(
                session_id,
                SessionStatus.RECORDING,
                recording_id=str(result.get("recordingId", "")),
            )
        except Exception as e:
            logger.error("Failed to start recording: %s — %s", session_id, e)
            session_repo.update_status(
                session_id, SessionStatus.ERROR, error_message=str(e)
            )
    elif count == 1:
        session_repo.update_status(session_id, SessionStatus.WAITING_FOR_GUEST)


async def on_participant_left(session_id: str, room_name: str) -> None:
    """Handle participant.left webhook — stop recording if needed, cleanup."""
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        return

    count: int = session_repo.increment_participant_count(session_id, -1)

    if count < 2 and session.status == SessionStatus.RECORDING:
        logger.info("Participant left during recording — stopping: %s", session_id)
        await daily_client.stop_recording(room_name)
        session_repo.update_status(session_id, SessionStatus.STOPPING)

    if count <= 0:
        session_repo.update_status(session_id, SessionStatus.PROCESSING)
        await daily_client.delete_room(room_name)


def on_recording_started(session_id: str, start_ts: str) -> None:
    """Handle recording.started webhook."""
    session_repo.update_status(
        session_id, SessionStatus.RECORDING, recording_started_at=start_ts
    )


def on_recording_stopped(session_id: str, timestamp: str) -> None:
    """Handle recording.stopped webhook."""
    session_repo.update_status(
        session_id, SessionStatus.PROCESSING, recording_stopped_at=timestamp
    )


def on_recording_error(session_id: str, error_msg: str) -> None:
    """Handle recording.error webhook."""
    logger.error("Recording error: %s — %s", session_id, error_msg)
    session_repo.update_status(
        session_id, SessionStatus.ERROR, error_message=error_msg
    )


# ─── Helpers ──────────────────────────────────────

def _to_session_response(session: Session) -> SessionResponse:
    return SessionResponse(
        session_id=session.session_id,
        status=session.status.value,
        host_user_id=session.host_user_id,
        host_name=session.host_name,
        guest_name=session.guest_name,
        participant_count=session.participant_count,
        recording_segments=session.recording_segments,
        recording_started_at=session.recording_started_at,
        recording_stopped_at=session.recording_stopped_at,
        s3_processed_prefix=session.s3_processed_prefix,
        error_message=session.error_message,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


# ─── Exceptions ──────────────────────────────────

class SessionNotFoundError(Exception):
    def __init__(self, session_id: str) -> None:
        self.session_id: str = session_id
        super().__init__(f"Session not found: {session_id}")


class InvalidSessionStateError(Exception):
    def __init__(self, session_id: str, current_status: SessionStatus, action: str) -> None:
        self.session_id: str = session_id
        self.current_status: SessionStatus = current_status
        self.action: str = action
        super().__init__(f"Cannot {action} session '{session_id}' in '{current_status}' status")
