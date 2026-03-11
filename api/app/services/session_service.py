"""
Session Service — business logic layer.

This is the core orchestration layer for session lifecycle management.
It coordinates between the DynamoDB repo, Daily.co client, and enforces
business rules like valid state transitions.

Architecture:
  Routes (thin HTTP layer) → Service (this file) → Repo (DynamoDB CRUD)
                                                  → DailyClient (external API)

State management strategy:
  - The FRONTEND is the primary driver of state changes. Every user action
    (join, leave, start, stop, pause, resume) calls a dedicated API endpoint
    that immediately updates DynamoDB.
  - WEBHOOKS from Daily.co act as reconciliation and safety net. They only
    advance state forward (never regress) using STATUS_PRIORITY ordering.
    This prevents stale/delayed webhooks from overwriting newer state.
  - See _can_transition() for the guard logic.

Session lifecycle:
  created → waiting_for_guest → ready → recording ⇄ paused → processing → completed
                                                             ↘ error (terminal, from webhook only)
"""

import uuid
import logging

from app.constants import SessionStatus, SESSION_ID_LENGTH, STATUS_PRIORITY
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


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FE-initiated actions (primary state drivers)
#
# These are called directly by the frontend via REST endpoints.
# Each function validates the current state, calls Daily.co if needed,
# and updates DynamoDB. The frontend receives the new status in the
# response and updates its local UI state accordingly.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


async def create_session(req: CreateSessionRequest) -> CreateSessionResponse:
    """Create a new session: Daily.co room + host/guest tokens + DynamoDB record.

    Flow: FE submits form → this creates everything → FE navigates to AudioRoom.
    DynamoDB: status = created, participant_count = 0
    """
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
    """Retrieve session by ID. Used by FE to poll status on the complete page."""
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)
    return _to_session_response(session)


async def join_session(session_id: str) -> SessionActionResponse:
    """FE notifies server that a participant joined the Daily.co room.

    Called fire-and-forget by the FE when daily-js reports 'joined-meeting'.
    Increments participant_count and transitions created → waiting_for_guest.

    DynamoDB: participant_count += 1, status → waiting_for_guest (if first joiner)
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    count: int = session_repo.increment_participant_count(session_id, 1)

    # First participant joins → move from created to waiting_for_guest
    if count == 1 and session.status == SessionStatus.CREATED:
        session_repo.update_status(session_id, SessionStatus.WAITING_FOR_GUEST)
        return SessionActionResponse(session_id=session_id, status=SessionStatus.WAITING_FOR_GUEST)

    # Second participant joins → both are in the room, ready to record
    if count >= 2 and session.status == SessionStatus.WAITING_FOR_GUEST:
        session_repo.update_status(session_id, SessionStatus.READY)
        return SessionActionResponse(session_id=session_id, status=SessionStatus.READY)

    return SessionActionResponse(session_id=session_id, status=session.status)


async def start_recording(session_id: str) -> SessionActionResponse:
    """Host clicks "Start Recording" → calls Daily.co start_recording API.

    Allowed from: ready (both participants in room). Also allows
    waiting_for_guest if host wants to start before guest arrives.
    DynamoDB: status → recording, recording_segments = 1, recording_started_at set.
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    if session.status not in (SessionStatus.WAITING_FOR_GUEST, SessionStatus.READY):
        raise InvalidSessionStateError(session_id, session.status, "start recording")

    result: dict[str, object] = await daily_client.start_recording(session.daily_room_name)
    session_repo.update_status(
        session_id,
        SessionStatus.RECORDING,
        recording_id=str(result.get("recordingId", "")),
        recording_segments="1",
        recording_started_at=now_iso(),
    )
    return SessionActionResponse(session_id=session_id, status=SessionStatus.RECORDING)


async def pause_session(session_id: str) -> SessionActionResponse:
    """Host clicks "Pause" → stops the current recording segment.

    Resuming later starts a new recording segment (increment recording_segments).
    DynamoDB: status → paused.
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    if session.status != SessionStatus.RECORDING:
        raise InvalidSessionStateError(session_id, session.status, "pause")

    await daily_client.stop_recording(session.daily_room_name)
    session_repo.update_status(session_id, SessionStatus.PAUSED)
    return SessionActionResponse(session_id=session_id, status=SessionStatus.PAUSED)


async def resume_session(session_id: str) -> SessionActionResponse:
    """Host clicks "Resume" → starts a new recording segment.

    Each pause/resume cycle increments recording_segments.
    DynamoDB: status → recording, recording_segments += 1.
    """
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


async def stop_session(session_id: str) -> SessionActionResponse:
    """Host clicks "Stop Recording" → stops recording, moves to processing.

    After this, Daily.co will upload raw audio files to S3, which triggers
    the audio-merger Lambda via S3 event notification.
    DynamoDB: status → processing, recording_stopped_at set.
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    if session.status not in (SessionStatus.RECORDING, SessionStatus.PAUSED):
        raise InvalidSessionStateError(session_id, session.status, "stop")

    await daily_client.stop_recording(session.daily_room_name)
    session_repo.update_status(
        session_id,
        SessionStatus.PROCESSING,
        recording_stopped_at=now_iso(),
    )
    return SessionActionResponse(session_id=session_id, status=SessionStatus.PROCESSING)


async def leave_session(session_id: str) -> SessionActionResponse:
    """FE notifies server that a participant left the Daily.co room.

    Called fire-and-forget by the FE when the user navigates away or daily-js
    reports 'left-meeting'. Handles two edge cases:
    1. If someone leaves mid-recording → auto-stop recording and move to processing.
    2. If room is now empty (count <= 0) → delete the Daily.co room to clean up.

    DynamoDB: participant_count -= 1, possibly status → processing.
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    count: int = session_repo.increment_participant_count(session_id, -1)

    # Edge case: participant left while recording was active → auto-stop
    if count < 2 and session.status == SessionStatus.RECORDING:
        logger.info("Participant left during recording — stopping: %s", session_id)
        await daily_client.stop_recording(session.daily_room_name)
        session_repo.update_status(
            session_id, SessionStatus.PROCESSING, recording_stopped_at=now_iso()
        )
        return SessionActionResponse(session_id=session_id, status=SessionStatus.PROCESSING)

    # Cleanup: delete Daily.co room when everyone has left
    if count <= 0:
        await daily_client.delete_room(session.daily_room_name)

    return SessionActionResponse(session_id=session_id, status=session.status)


async def list_sessions_by_host(host_user_id: str, limit: int = 20) -> list[SessionResponse]:
    """List sessions for a given host user, ordered by most recent first."""
    sessions: list[Session] = session_repo.get_by_host(host_user_id, limit=limit)
    return [_to_session_response(s) for s in sessions]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Webhook event handlers (reconciliation + safety net)
#
# Daily.co sends webhooks for room events. Since the FE already drives
# all state changes via the endpoints above, webhooks serve two purposes:
#
# 1. RECONCILIATION — Fill in data the FE couldn't set (e.g. Daily's own
#    recording timestamp), or correct state if the FE call was missed
#    (e.g. slow network, user closed tab before call completed).
#
# 2. SAFETY NET — Catch events the FE can't report: browser crashes,
#    network drops, and server-side recording errors.
#
# Guard: _can_transition() ensures webhooks NEVER regress state.
# A delayed "recording.started" webhook arriving after the FE already
# moved the session to "processing" will be silently skipped.
#
# Status priority (see constants.py):
#   created(0) → waiting_for_guest(1) → recording/paused(2) → stopping(3)
#   → processing(4) → completed/error(5)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def _can_transition(current: SessionStatus, target: SessionStatus) -> bool:
    """Return True only if target status is at the same or higher priority.

    This prevents stale webhooks from moving state backward.
    Example: recording(2) → processing(4) = allowed.
             processing(4) → recording(2) = blocked.
    """
    return STATUS_PRIORITY.get(target, 0) >= STATUS_PRIORITY.get(current, 0)


async def on_participant_joined(session_id: str, _room_name: str) -> None:
    """Webhook: participant.joined — RECONCILIATION.

    Only acts if session is still in 'created' or 'waiting_for_guest' status,
    meaning the FE's join_session() call hasn't been processed yet. If the FE
    already moved the session forward, this is a no-op.
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        logger.warning("Webhook: session not found: %s", session_id)
        return

    if not _can_transition(session.status, SessionStatus.READY):
        logger.info(
            "Webhook skipped: participant.joined for %s (status=%s already ahead)",
            session_id, session.status,
        )
        return

    count: int = session_repo.increment_participant_count(session_id, 1)

    if session.status == SessionStatus.CREATED and count == 1:
        session_repo.update_status(session_id, SessionStatus.WAITING_FOR_GUEST)
        logger.info("Webhook reconciliation: first participant joined %s", session_id)
    elif session.status == SessionStatus.WAITING_FOR_GUEST and count >= 2:
        session_repo.update_status(session_id, SessionStatus.READY)
        logger.info("Webhook reconciliation: second participant joined %s → ready", session_id)


async def on_participant_left(session_id: str, room_name: str) -> None:
    """Webhook: participant.left — SAFETY NET.

    Critical for handling browser crashes where the FE couldn't call
    leave_session(). Always decrements participant_count (additive operation,
    not a status regression). If a participant leaves mid-recording and the
    FE didn't report it, this auto-stops the recording.
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        return

    count: int = session_repo.increment_participant_count(session_id, -1)

    # Auto-stop recording if participant left mid-recording (safety net for browser crash)
    if count < 2 and session.status == SessionStatus.RECORDING:
        logger.info(
            "Webhook safety net: participant left during recording — stopping: %s",
            session_id,
        )
        await daily_client.stop_recording(room_name)
        session_repo.update_status(
            session_id, SessionStatus.PROCESSING, recording_stopped_at=now_iso()
        )

    # Cleanup Daily.co room when all participants have left
    if count <= 0:
        await daily_client.delete_room(room_name)


def on_recording_started(session_id: str, start_ts: str) -> None:
    """Webhook: recording.started — RECONCILIATION.

    The FE's start_recording() already sets status=recording and
    recording_started_at. This webhook only fills in the timestamp
    if the FE didn't set it (e.g. FE call succeeded at Daily.co
    but DynamoDB write was slow). Skipped if status has already
    moved past recording (e.g. already processing/completed).
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        return

    if not _can_transition(session.status, SessionStatus.RECORDING):
        logger.info(
            "Webhook skipped: recording.started for %s (status=%s already ahead)",
            session_id, session.status,
        )
        return

    if not session.recording_started_at:
        session_repo.update_status(
            session_id, SessionStatus.RECORDING, recording_started_at=start_ts
        )
        logger.info("Webhook reconciliation: recording_started_at set for %s", session_id)


def on_recording_stopped(session_id: str, timestamp: str) -> None:
    """Webhook: recording.stopped — RECONCILIATION.

    The FE's stop_session() already moves status to processing.
    This webhook catches the case where the FE call failed (e.g. network
    error after Daily.co accepted the stop). Skipped if the session
    is already at processing or beyond.
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        return

    if not _can_transition(session.status, SessionStatus.PROCESSING):
        logger.info(
            "Webhook skipped: recording.stopped for %s (status=%s already ahead)",
            session_id, session.status,
        )
        return

    session_repo.update_status(
        session_id, SessionStatus.PROCESSING, recording_stopped_at=timestamp
    )
    logger.info("Webhook reconciliation: recording stopped for %s", session_id)


def on_recording_error(session_id: str, error_msg: str) -> None:
    """Webhook: recording.error — PRIMARY (not reconciliation).

    This is the ONLY way to know about async server-side recording failures.
    The FE has no visibility into Daily.co's internal recording pipeline.
    ERROR is a terminal state — always applied regardless of current status
    (no _can_transition check needed).
    """
    logger.error("Recording error: %s — %s", session_id, error_msg)
    session_repo.update_status(
        session_id, SessionStatus.ERROR, error_message=error_msg
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
        participant_count=session.participant_count,
        recording_segments=session.recording_segments,
        recording_started_at=session.recording_started_at,
        recording_stopped_at=session.recording_stopped_at,
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
