"""
Session Service — business logic layer.

This is the core orchestration layer for session lifecycle management.
It coordinates between the DynamoDB repo, Daily.co client, and enforces
business rules like valid state transitions.

Architecture:
  Routes (thin HTTP layer) → Service (this file) → Repo (DynamoDB CRUD)
                                                  → DailyClient (external API)

Key design decisions (see ARCHITECTURE.md):
  - DynamoDB is single source of truth. UI renders from server state.
  - Leave = auto-pause (recoverable). Only "End Session" is terminal.
  - Three participant fields: active_participants set, participant_connections map,
    participants roster. See ARCHITECTURE.md "Why Three Participant Fields".
  - Webhook handlers check connection map for stale detection on refresh.
  - No sendBeacon — webhooks handle all involuntary disconnects.

Session lifecycle:
  created → waiting_for_guest → ready → recording ⇄ paused → processing → completed
                                                              ↘ error (terminal)
"""

import uuid
import logging

from app.config import settings
from app.constants import SessionStatus, SESSION_ID_LENGTH
from app.models.session import Session
from app.repos import session_repo
from app.services.daily_client import daily_client
from app.types.requests import CreateSessionRequest, JoinRequest, LeaveRequest
from app.types.responses import (
    CreateSessionResponse,
    SessionResponse,
    SessionActionResponse,
)
from app.utils.time import now_iso, compute_ttl

logger: logging.Logger = logging.getLogger(__name__)


def _generate_session_id() -> str:
    return uuid.uuid4().hex[:SESSION_ID_LENGTH]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FE-initiated actions (primary state drivers)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


async def create_session(req: CreateSessionRequest) -> CreateSessionResponse:
    """Create a new session: Daily.co room + host/guest tokens + DynamoDB record."""
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

    logger.info(
        "Session created: id=%s room=%s host=%s",
        session_id, room_name, req.host_user_id,
    )

    return CreateSessionResponse(
        session_id=session_id,
        room_url=room_url,
        host_token=host_token,
        guest_token=guest_token,
        guest_join_url=f"{settings.frontend_origin}/join/{session_id}?t={guest_token}",
    )


async def get_session(session_id: str) -> SessionResponse:
    """Retrieve session by ID. Used by FE to poll status."""
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)
    return _to_session_response(session)


async def join_session(session_id: str, req: JoinRequest) -> SessionActionResponse:
    """FE reports: participant joined the Daily.co room.

    Called BLOCKING by the FE after Daily SDK joins. Sends user_id,
    connection_id (Daily's session_id), and user_name.

    Uses atomic ADD to active_participants set + SET to connection map.
    Then transitions status based on set size:
      count == 1, status == created     → waiting_for_guest
      count >= 2, status <= waiting     → ready
    """
    # Verify session exists before the atomic update
    existing: Session | None = session_repo.get_by_id(session_id)
    if existing is None:
        raise SessionNotFoundError(session_id)

    # Atomic add — returns full updated session with new set size
    session: Session = session_repo.add_participant(
        session_id=session_id,
        user_id=req.user_id,
        connection_id=req.connection_id,
        user_name=req.user_name,
    )

    count: int = session.participant_count
    new_status: SessionStatus = session.status

    # Status transitions based on participant count
    if count == 1 and session.status == SessionStatus.CREATED:
        session_repo.update_status(session_id, SessionStatus.WAITING_FOR_GUEST)
        new_status = SessionStatus.WAITING_FOR_GUEST
        logger.info("Join transition: session=%s created -> waiting_for_guest", session_id)

    elif count >= 2 and session.status in (
        SessionStatus.CREATED, SessionStatus.WAITING_FOR_GUEST,
    ):
        session_repo.update_status(session_id, SessionStatus.READY)
        new_status = SessionStatus.READY
        logger.info("Join transition: session=%s -> ready (count=%d)", session_id, count)

    return SessionActionResponse(session_id=session_id, status=new_status)


async def start_recording(session_id: str) -> SessionActionResponse:
    """Host starts recording. MUST be in ready state (requires 2 participants).

    Uses conditional update: only succeeds if status == ready.
    Double-click protection: second call fails (status already recording).
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    if session.status != SessionStatus.READY:
        raise InvalidSessionStateError(session_id, session.status, "start recording")

    if session.participant_count < 2:
        raise InvalidSessionStateError(
            session_id, session.status,
            f"start recording (need 2 participants, currently {session.participant_count})",
        )

    result: dict[str, object] = await daily_client.start_recording(session.daily_room_name)
    recording_id = str(result.get("recordingId", ""))

    success: bool = session_repo.conditional_update_status(
        session_id=session_id,
        new_status=SessionStatus.RECORDING,
        required_status=SessionStatus.READY,
        recording_id=recording_id,
        recording_segments="1",
        recording_started_at=now_iso(),
    )
    if not success:
        raise InvalidSessionStateError(session_id, session.status, "start recording")

    logger.info(
        "Recording started: session=%s recording_id=%s",
        session_id, recording_id,
    )
    return SessionActionResponse(session_id=session_id, status=SessionStatus.RECORDING)


async def pause_session(session_id: str) -> SessionActionResponse:
    """Host pauses recording. Stops the current Daily.co recording segment.

    Uses conditional update: only succeeds if status == recording.
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    if session.status != SessionStatus.RECORDING:
        raise InvalidSessionStateError(session_id, session.status, "pause")

    await daily_client.stop_recording(session.daily_room_name)

    success: bool = session_repo.conditional_update_status(
        session_id=session_id,
        new_status=SessionStatus.PAUSED,
        required_status=SessionStatus.RECORDING,
        last_pause_at=now_iso(),
    )
    if not success:
        raise InvalidSessionStateError(session_id, session.status, "pause")

    logger.info("Recording paused: session=%s", session_id)
    return SessionActionResponse(session_id=session_id, status=SessionStatus.PAUSED)


async def resume_session(session_id: str) -> SessionActionResponse:
    """Host resumes recording. Requires status == paused AND 2 participants.

    Starts a new Daily.co recording segment (increments recording_segments).
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    if session.status != SessionStatus.PAUSED:
        raise InvalidSessionStateError(session_id, session.status, "resume")

    if session.participant_count < 2:
        raise InvalidSessionStateError(
            session_id, session.status,
            f"resume (need 2 participants, currently {session.participant_count})",
        )

    await daily_client.start_recording(session.daily_room_name)
    new_segments: int = session.recording_segments + 1

    success: bool = session_repo.conditional_update_status(
        session_id=session_id,
        new_status=SessionStatus.RECORDING,
        required_status=SessionStatus.PAUSED,
        recording_segments=str(new_segments),
    )
    if not success:
        raise InvalidSessionStateError(session_id, session.status, "resume")

    logger.info(
        "Recording resumed: session=%s segment=%d", session_id, new_segments,
    )
    return SessionActionResponse(session_id=session_id, status=SessionStatus.RECORDING)


async def end_session(session_id: str) -> SessionActionResponse:
    """Host ends session — ONLY terminal user action.

    Moves to processing. If currently recording, stops Daily.co recording first.
    If paused, skip stop (already stopped).

    Uses conditional update: only succeeds if status IN (recording, paused).
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    if session.status not in (SessionStatus.RECORDING, SessionStatus.PAUSED):
        raise InvalidSessionStateError(session_id, session.status, "end session")

    # Only call Daily.co stop if actively recording (pause already stopped it)
    if session.status == SessionStatus.RECORDING:
        await daily_client.stop_recording(session.daily_room_name)

    success: bool = session_repo.conditional_update_status(
        session_id=session_id,
        new_status=SessionStatus.PROCESSING,
        required_status=[SessionStatus.RECORDING, SessionStatus.PAUSED],
        recording_stopped_at=now_iso(),
    )
    if not success:
        raise InvalidSessionStateError(session_id, session.status, "end session")

    logger.info("Session ended: session=%s -> processing", session_id)
    return SessionActionResponse(session_id=session_id, status=SessionStatus.PROCESSING)


async def leave_session(session_id: str, req: LeaveRequest) -> SessionActionResponse:
    """FE reports: participant explicitly clicked Leave.

    Removes user from active set + connection map.
    If recording and count drops below 2 → auto-pause (NOT processing).
    If not recording and count drops below 2 → regress ready → waiting_for_guest.
    """
    existing: Session | None = session_repo.get_by_id(session_id)
    if existing is None:
        raise SessionNotFoundError(session_id)

    # Atomic remove — returns full updated session
    session: Session = session_repo.remove_participant(session_id, req.user_id)
    count: int = session.participant_count

    # Auto-pause if participant left during recording
    if count < 2 and session.status == SessionStatus.RECORDING:
        logger.info(
            "Auto-pause: participant %s left during recording — session=%s",
            req.user_id, session_id,
        )
        await daily_client.stop_recording(session.daily_room_name)
        session_repo.conditional_update_status(
            session_id=session_id,
            new_status=SessionStatus.PAUSED,
            required_status=SessionStatus.RECORDING,
            last_pause_at=now_iso(),
        )
        return SessionActionResponse(session_id=session_id, status=SessionStatus.PAUSED)

    # Regress ready → waiting_for_guest if participant left before recording
    if count < 2 and session.status == SessionStatus.READY:
        session_repo.update_status(session_id, SessionStatus.WAITING_FOR_GUEST)
        logger.info(
            "Regress: participant %s left — session=%s ready -> waiting_for_guest",
            req.user_id, session_id,
        )
        return SessionActionResponse(
            session_id=session_id, status=SessionStatus.WAITING_FOR_GUEST,
        )

    return SessionActionResponse(session_id=session_id, status=session.status)


async def list_sessions_by_host(host_user_id: str, limit: int = 20) -> list[SessionResponse]:
    """List sessions for a given host user, ordered by most recent first."""
    sessions: list[Session] = session_repo.get_by_host(host_user_id, limit=limit)
    return [_to_session_response(s) for s in sessions]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Webhook event handlers (reconciliation + safety net)
#
# 4 events handled:
#   participant.joined        — reconciliation (same atomic join update)
#   participant.left          — safety net (stale detection + auto-pause)
#   recording.ready-to-download — store s3_key for processing pipeline
#   recording.error           — primary (terminal, always applies)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


async def on_participant_joined(
    session_id: str,
    user_id: str,
    connection_id: str,
    user_name: str,
) -> None:
    """Webhook: participant.joined — RECONCILIATION.

    Uses the SAME atomic add_participant() as the FE endpoint.
    If FE already handled this, ADD is a no-op (idempotent).
    Then checks set size for status transitions.
    """
    existing: Session | None = session_repo.get_by_id(session_id)
    if existing is None:
        logger.warning("Webhook participant.joined: session not found: %s", session_id)
        return

    # Same atomic update as FE join
    session: Session = session_repo.add_participant(
        session_id=session_id,
        user_id=user_id,
        connection_id=connection_id,
        user_name=user_name,
    )

    count: int = session.participant_count

    # Mirror FE join_session logic exactly
    if count == 1 and session.status == SessionStatus.CREATED:
        session_repo.update_status(session_id, SessionStatus.WAITING_FOR_GUEST)
        logger.info(
            "Webhook reconciliation: session=%s created -> waiting_for_guest",
            session_id,
        )

    elif count >= 2 and session.status in (
        SessionStatus.CREATED, SessionStatus.WAITING_FOR_GUEST,
    ):
        session_repo.update_status(session_id, SessionStatus.READY)
        logger.info(
            "Webhook reconciliation: session=%s -> ready (count=%d)",
            session_id, count,
        )
    else:
        logger.info(
            "Webhook no-op: participant.joined session=%s status=%s count=%d",
            session_id, session.status, count,
        )


async def on_participant_left(
    session_id: str,
    user_id: str,
    connection_id: str,
) -> None:
    """Webhook: participant.left — SAFETY NET for crashes/tab close.

    CRITICAL: Checks connection map for stale webhooks (refresh detection).

    Flow:
    1. Read session → get stored connection for this user_id
    2. If no stored connection → FE /leave already removed it → SKIP
    3. If stored != webhook's connection_id → STALE (user refreshed) → SKIP
    4. If match → CURRENT (real disconnect) → proceed with removal
    5. After removal: auto-pause if recording, regress if ready
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        logger.warning("Webhook participant.left: session not found: %s", session_id)
        return

    # Check for stale webhook (see ARCHITECTURE.md "Webhook participant.left")
    stored_conn: str | None = session.participant_connections.get(user_id)

    if stored_conn is None:
        # FE /leave already removed this user's connection entry
        logger.info(
            "Webhook skip: participant.left user=%s already removed by FE /leave — session=%s",
            user_id, session_id,
        )
        return

    if stored_conn != connection_id:
        # STALE — user already reconnected with a new connection (e.g. page refresh)
        logger.info(
            "Webhook skip: stale participant.left user=%s (stored=%s, webhook=%s) — session=%s",
            user_id, stored_conn, connection_id, session_id,
        )
        return

    # CURRENT — user really disconnected → proceed with removal
    logger.info(
        "Webhook: participant.left user=%s conn=%s — real disconnect — session=%s",
        user_id, connection_id, session_id,
    )
    updated: Session = session_repo.remove_participant(session_id, user_id)
    count: int = updated.participant_count

    # Auto-pause if participant left during recording
    if count < 2 and updated.status == SessionStatus.RECORDING:
        logger.info(
            "Webhook auto-pause: participant left during recording — session=%s",
            session_id,
        )
        await daily_client.stop_recording(updated.daily_room_name)
        session_repo.conditional_update_status(
            session_id=session_id,
            new_status=SessionStatus.PAUSED,
            required_status=SessionStatus.RECORDING,
            last_pause_at=now_iso(),
        )
        return

    # Regress ready → waiting_for_guest
    if count < 2 and updated.status == SessionStatus.READY:
        session_repo.update_status(session_id, SessionStatus.WAITING_FOR_GUEST)
        logger.info(
            "Webhook regress: participant left — session=%s ready -> waiting_for_guest",
            session_id,
        )


async def on_recording_ready_to_download(
    session_id: str,
    recording_id: str,
    s3_key: str,
) -> None:
    """Webhook: recording.ready-to-download — store s3_key for processing pipeline.

    This fires when Daily.co finishes uploading raw tracks to S3.
    NOT used for pause/resume/leave logic — purely for S3 data capture.

    Guard: Skip if status == paused (pause-induced stop, s3_key still stored).
    Guard: Skip if status >= processing (already terminal).
    Safety net: If status still == recording (our DynamoDB write failed),
    this is a reconciliation opportunity — but we do NOT move to processing.
    Only "End Session" does that.
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        logger.warning(
            "Webhook recording.ready-to-download: session not found: %s", session_id,
        )
        return

    # Always store s3_key if present (useful for processing pipeline)
    if s3_key:
        session_repo.update_status(
            session_id, session.status, s3_key=s3_key,
        )
        logger.info(
            "Webhook: recording.ready-to-download — stored s3_key for session=%s recording=%s",
            session_id, recording_id,
        )

    logger.info(
        "Webhook: recording.ready-to-download session=%s status=%s",
        session_id, session.status,
    )


def on_recording_error(session_id: str, error_msg: str) -> None:
    """Webhook: recording.error — PRIMARY (not reconciliation).

    This is the ONLY way to know about server-side recording failures.
    ERROR is terminal — always applied regardless of current status.
    """
    logger.error(
        "Recording error: session=%s error=%s", session_id, error_msg,
    )
    session_repo.update_status(
        session_id, SessionStatus.ERROR, error_message=error_msg,
    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Helpers
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def _to_session_response(session: Session) -> SessionResponse:
    return SessionResponse(
        session_id=session.session_id,
        status=session.status.value,
        host_user_id=session.host_user_id,
        host_name=session.host_name,
        guest_name=session.guest_name,
        daily_room_url=session.daily_room_url,
        participant_count=session.participant_count,
        active_participants=sorted(session.active_participants),
        participants=session.participants,
        recording_segments=session.recording_segments,
        recording_started_at=session.recording_started_at,
        recording_stopped_at=session.recording_stopped_at,
        s3_key=session.s3_key,
        s3_processed_prefix=session.s3_processed_prefix,
        error_message=session.error_message,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Exceptions
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class SessionNotFoundError(Exception):
    """Raised when a session_id does not exist in DynamoDB."""

    def __init__(self, session_id: str) -> None:
        self.session_id: str = session_id
        super().__init__(f"Session not found: {session_id}")


class InvalidSessionStateError(Exception):
    """Raised when an action is attempted on a session in an incompatible status."""

    def __init__(self, session_id: str, current_status: SessionStatus, action: str) -> None:
        self.session_id: str = session_id
        self.current_status: SessionStatus = current_status
        self.action: str = action
        super().__init__(f"Cannot {action} session '{session_id}' in '{current_status}' status")
