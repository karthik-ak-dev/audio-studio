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
  created → waiting_for_guest → ready → recording ⇄ paused → processing → completed → cancelled
                                                              ↘ error (terminal)
"""

import json
import uuid
import logging
from datetime import datetime, timezone

import boto3
import httpx

from app.config import settings
from app.constants import SessionStatus, SESSION_ID_LENGTH
from app.models.session import Session
from app.repos import session_repo
from app.services.daily_client import daily_client
from app.services.s3_client import generate_presigned_url
from app.types.requests import CreateSessionRequest, JoinRequest, LeaveRequest
from app.types.responses import (
    CreateSessionResponse,
    SessionResponse,
    SessionActionResponse,
)
from app.utils.identity import name_from_email
from app.utils.time import now_iso, unix_to_iso

logger: logging.Logger = logging.getLogger(__name__)


def _generate_session_id() -> str:
    return uuid.uuid4().hex[:SESSION_ID_LENGTH]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FE-initiated actions (primary state drivers)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


async def create_session(req: CreateSessionRequest) -> CreateSessionResponse:
    """Create a new session: Daily.co room + host/guest tokens + DynamoDB record."""
    session_id: str = _generate_session_id()

    # If recording_id is provided, validate it exists and pull identity from it
    recording_name: str | None = None
    rec_host_name: str | None = None
    rec_guest_name: str | None = None
    rec_guest_user_id: str | None = None
    if req.recording_id:
        from app.repos import recording_repo
        recording = recording_repo.get_by_id(req.recording_id)
        if recording is None:
            raise InvalidSessionStateError(session_id, SessionStatus.CREATED, "invalid recording_id")
        if recording.host_user_id != req.host_user_id:
            raise InvalidSessionStateError(
                session_id, SessionStatus.CREATED,
                "recording does not belong to this host",
            )
        recording_name = recording.recording_name
        rec_host_name = recording.host_name
        rec_guest_name = recording.guest_name
        rec_guest_user_id = recording.guest_user_id

    room: dict[str, object] = await daily_client.create_room(session_id)
    room_name: str = str(room["name"])
    room_url: str = str(room["url"])
    room_config: dict[str, object] = room.get("config", {})  # type: ignore[assignment]
    room_expires_at: str = unix_to_iso(int(room_config["exp"]))

    # When recording_id is set, identity comes from the Recording — not the request.
    # Names are derived from emails when not explicitly provided.
    host_name: str = rec_host_name or req.host_name or name_from_email(req.host_user_id)
    guest_user_id: str = rec_guest_user_id or req.guest_user_id or f"guest-{session_id}"
    guest_name: str = rec_guest_name or req.guest_name or name_from_email(guest_user_id)

    host_token: str = await daily_client.create_token(
        room_name=room_name,
        user_id=req.host_user_id,
        user_name=host_name,
        is_owner=True,
    )
    guest_token: str = await daily_client.create_token(
        room_name=room_name,
        user_id=guest_user_id,
        user_name=guest_name,
        is_owner=False,
    )

    now: str = now_iso()
    session: Session = Session(
        session_id=session_id,
        host_user_id=req.host_user_id,
        host_name=host_name,
        guest_name=guest_name,
        guest_user_id=guest_user_id if guest_user_id != f"guest-{session_id}" else None,
        recording_id=req.recording_id,
        recording_name=recording_name,
        daily_room_name=room_name,
        daily_room_url=room_url,
        status=SessionStatus.CREATED,
        host_token=host_token,
        guest_token=guest_token,
        created_at=now,
        updated_at=now,
        room_expires_at=room_expires_at,
    )
    session_repo.create(session)

    logger.info(
        "Session created: id=%s room=%s host=%s recording=%s",
        session_id, room_name, req.host_user_id, req.recording_id,
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
    logger.info(
        "Join: session=%s user=%s conn=%s name=%s",
        session_id, req.user_id, req.connection_id, req.user_name,
    )

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
    daily_recording_id = str(result.get("recordingId", ""))

    success: bool = session_repo.conditional_update_status(
        session_id=session_id,
        new_status=SessionStatus.RECORDING,
        required_status=SessionStatus.READY,
        daily_recording_id=daily_recording_id,
        recording_started_at=now_iso(),
    )
    if not success:
        raise InvalidSessionStateError(session_id, session.status, "start recording")

    logger.info(
        "Recording started: session=%s daily_recording_id=%s",
        session_id, daily_recording_id,
    )
    return SessionActionResponse(session_id=session_id, status=SessionStatus.RECORDING)


async def pause_session(session_id: str) -> SessionActionResponse:
    """Host pauses recording. Logical pause — Daily recording keeps running.

    Only updates DynamoDB status and appends to pause_events.
    No Daily API call (recording continues, audio trimmed in post-processing).
    Uses conditional update: only succeeds if status == recording.
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    if session.status != SessionStatus.RECORDING:
        raise InvalidSessionStateError(session_id, session.status, "pause")

    pause_ts: str = now_iso()
    success: bool = session_repo.conditional_update_status(
        session_id=session_id,
        new_status=SessionStatus.PAUSED,
        required_status=SessionStatus.RECORDING,
    )
    if not success:
        raise InvalidSessionStateError(session_id, session.status, "pause")

    session_repo.append_pause_event(session_id, pause_ts)

    logger.info("Recording paused (logical): session=%s", session_id)
    return SessionActionResponse(session_id=session_id, status=SessionStatus.PAUSED)


async def resume_session(session_id: str) -> SessionActionResponse:
    """Host resumes recording. Logical resume — Daily recording is already running.

    Only updates DynamoDB status and sets resumed_at on the last pause_events entry.
    No Daily API call. Requires status == paused AND 2 participants.
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

    success: bool = session_repo.conditional_update_status(
        session_id=session_id,
        new_status=SessionStatus.RECORDING,
        required_status=SessionStatus.PAUSED,
    )
    if not success:
        raise InvalidSessionStateError(session_id, session.status, "resume")

    session_repo.update_last_pause_event_resume(session_id, now_iso())

    logger.info("Recording resumed (logical): session=%s", session_id)
    return SessionActionResponse(session_id=session_id, status=SessionStatus.RECORDING)


async def end_session(session_id: str) -> SessionActionResponse:
    """Host ends session — ONLY terminal user action.

    Moves to processing. Always stops the Daily.co recording — this is the
    ONLY place stop_recording is called (logical pause keeps recording running).

    Uses conditional update: only succeeds if status IN (recording, paused).
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    if session.status not in (SessionStatus.RECORDING, SessionStatus.PAUSED):
        raise InvalidSessionStateError(session_id, session.status, "end session")

    logger.info(
        "End session: session=%s current_status=%s room=%s — stopping recording",
        session_id, session.status.value, session.daily_room_name,
    )

    # Always stop — this is the ONLY place stop_recording is called
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


async def cancel_session(session_id: str, host_user_id: str, reason: str) -> SessionActionResponse:
    """Cancel a completed session — marks quality as unsatisfactory.

    Only the host can cancel. Only valid transition: completed → cancelled.
    Stores the cancellation reason for downstream visibility.
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)

    if session.host_user_id != host_user_id:
        raise InvalidSessionStateError(session_id, session.status, "cancel session — only the host can cancel")

    if session.status != SessionStatus.COMPLETED:
        raise InvalidSessionStateError(session_id, session.status, "cancel session")

    success: bool = session_repo.conditional_update_status(
        session_id=session_id,
        new_status=SessionStatus.CANCELLED,
        required_status=SessionStatus.COMPLETED,
        cancellation_reason=reason,
    )
    if not success:
        raise InvalidSessionStateError(session_id, session.status, "cancel session")

    logger.info("Session cancelled: session=%s reason=%s", session_id, reason)
    return SessionActionResponse(session_id=session_id, status=SessionStatus.CANCELLED)


async def leave_session(session_id: str, req: LeaveRequest) -> SessionActionResponse:
    """FE reports: participant explicitly clicked Leave.

    Removes user from active set + connection map.
    If recording and count drops below 2 → auto-pause (NOT processing).
    If not recording and count drops below 2 → regress ready → waiting_for_guest.
    """
    logger.info("Leave: session=%s user=%s", session_id, req.user_id)

    existing: Session | None = session_repo.get_by_id(session_id)
    if existing is None:
        raise SessionNotFoundError(session_id)

    # Atomic remove — returns full updated session
    session: Session = session_repo.remove_participant(session_id, req.user_id)
    count: int = session.participant_count

    # Auto-pause if participant left during recording (logical — recording keeps running)
    if count < 2 and session.status == SessionStatus.RECORDING:
        pause_ts: str = now_iso()
        logger.info(
            "Auto-pause (logical): participant %s left during recording — session=%s",
            req.user_id, session_id,
        )
        session_repo.conditional_update_status(
            session_id=session_id,
            new_status=SessionStatus.PAUSED,
            required_status=SessionStatus.RECORDING,
        )
        session_repo.append_pause_event(session_id, pause_ts)
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


async def list_sessions_by_guest(guest_user_id: str, limit: int = 20) -> list[SessionResponse]:
    """List sessions where user was a guest, ordered by most recent first."""
    sessions: list[Session] = session_repo.get_by_guest(guest_user_id, limit=limit)
    return [_to_session_response(s) for s in sessions]


async def list_sessions_by_host(host_user_id: str, limit: int = 20) -> list[SessionResponse]:
    """List sessions for a given host user, ordered by most recent first."""
    sessions: list[Session] = session_repo.get_by_host(host_user_id, limit=limit)
    return [_to_session_response(s) for s in sessions]




# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Webhook event handlers (reconciliation + safety net)
#
# 5 events handled:
#   participant.joined        — reconciliation (same atomic join update)
#   participant.left          — safety net (stale detection + auto-pause + expiry detection)
#   meeting.ended             — cleanup: mark abandoned pre-recording sessions as error
#   recording.ready-to-download — transition to processing + store s3_key + invoke audio-merger
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
        "Webhook: participant.left user=%s conn=%s — real disconnect — session=%s status=%s",
        user_id, connection_id, session_id, session.status.value,
    )
    updated: Session = session_repo.remove_participant(session_id, user_id)
    count: int = updated.participant_count
    logger.info(
        "Webhook: participant.left — after removal: session=%s count=%d status=%s",
        session_id, count, updated.status.value,
    )

    # Auto-pause if participant left during recording (logical — recording keeps running)
    if count < 2 and updated.status == SessionStatus.RECORDING:
        pause_ts: str = now_iso()
        logger.info(
            "Webhook auto-pause (logical): participant left during recording — session=%s",
            session_id,
        )
        session_repo.conditional_update_status(
            session_id=session_id,
            new_status=SessionStatus.PAUSED,
            required_status=SessionStatus.RECORDING,
        )
        session_repo.append_pause_event(session_id, pause_ts)
        return

    # Regress ready → waiting_for_guest
    if count < 2 and updated.status == SessionStatus.READY:
        session_repo.update_status(session_id, SessionStatus.WAITING_FOR_GUEST)
        logger.info(
            "Webhook regress: participant left — session=%s ready -> waiting_for_guest",
            session_id,
        )
        return

    # All participants gone + recording never started → mark as error ONLY if room expired.
    # If room still has time left, this is likely a refresh (participant will rejoin).
    if count == 0 and updated.status in (
        SessionStatus.CREATED, SessionStatus.WAITING_FOR_GUEST, SessionStatus.READY,
    ):
        room_expired = False
        if updated.room_expires_at:
            expires_at = datetime.fromisoformat(updated.room_expires_at.replace("Z", "+00:00"))
            room_expired = datetime.now(timezone.utc) >= expires_at

        if room_expired:
            logger.info(
                "Webhook: room expired, recording never started — session=%s status=%s",
                session_id, updated.status.value,
            )
            session_repo.update_status(
                session_id, SessionStatus.ERROR,
                error_message="Meeting expired — recording was never started",
            )
        else:
            logger.info(
                "Webhook: all participants left but room still active — session=%s "
                "expires_at=%s — skipping error (likely refresh)",
                session_id, updated.room_expires_at,
            )


async def on_meeting_ended(session_id: str) -> None:
    """Webhook: meeting.ended — fires ~20s after the last participant leaves.

    Handles Gap 1: both users leave voluntarily before recording started,
    room hasn't expired. No recording to save — mark as error.

    Guard: only acts if participant_count == 0. If someone has already
    rejoined (e.g. page refresh completes in 1-3s), count > 0 → skip.

    Does NOT handle RECORDING/PAUSED — those are handled by Daily's idle
    timeout which auto-stops the recording after 5 min, triggering
    recording.ready-to-download → audio-merger.
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        logger.warning("Webhook meeting.ended: session not found: %s", session_id)
        return

    logger.info(
        "Webhook meeting.ended: session=%s status=%s count=%d",
        session_id, session.status.value, session.participant_count,
    )

    if session.participant_count > 0:
        logger.info(
            "Webhook meeting.ended: participants still present (count=%d) — "
            "session=%s — ignoring (likely reconnect after refresh)",
            session.participant_count, session_id,
        )
        return

    if session.status in (
        SessionStatus.CREATED,
        SessionStatus.WAITING_FOR_GUEST,
        SessionStatus.READY,
    ):
        logger.info(
            "Webhook meeting.ended: no participants, recording never started — "
            "session=%s status=%s → error",
            session_id, session.status.value,
        )
        session_repo.update_status(
            session_id, SessionStatus.ERROR,
            error_message="Meeting ended — recording was never started",
        )
        return

    logger.info(
        "Webhook meeting.ended: session=%s status=%s — no action needed",
        session_id, session.status.value,
    )


async def on_recording_ready_to_download(
    session_id: str,
    recording_id: str,
    s3_key: str,
) -> None:
    """Webhook: recording.ready-to-download — store s3_key + invoke audio merger Lambda.

    Fires ONCE per session (one continuous recording — pause/resume are logical,
    Daily recording runs from Start to End Session without interruption).
    This fires when:
      - Host clicks End Session → stop_recording → Daily finalizes → this webhook
      - All participants leave → idle timeout (5 min) → Daily auto-stops → this webhook
      - Room expires with eject_at_room_exp → Daily auto-stops → this webhook

    1. Transitions RECORDING/PAUSED → PROCESSING (cleanup for idle timeout case).
    2. Stores s3_key in DynamoDB for reference.
    3. Invokes audio-merger Lambda asynchronously with {session_id, domain}.
    """
    session: Session | None = session_repo.get_by_id(session_id)
    if session is None:
        logger.warning(
            "Webhook recording.ready-to-download: session not found: %s", session_id,
        )
        return

    # If session is still in RECORDING/PAUSED (idle timeout auto-stopped the recording),
    # transition to PROCESSING so the status flow is clean.
    if session.status in (SessionStatus.RECORDING, SessionStatus.PAUSED):
        logger.info(
            "Webhook: recording.ready-to-download — session=%s still in %s, "
            "transitioning to processing (idle timeout auto-stop)",
            session_id, session.status.value,
        )
        session_repo.update_status(
            session_id, SessionStatus.PROCESSING,
            recording_stopped_at=now_iso(),
        )

    # Store s3_key if present (useful for debugging / reference)
    if s3_key:
        session_repo.update_status(
            session_id, SessionStatus.PROCESSING, s3_key=s3_key,
        )
        logger.info(
            "Webhook: recording.ready-to-download — stored s3_key for session=%s recording=%s",
            session_id, recording_id,
        )

    # Invoke audio-merger — HTTP locally, Lambda in deployed environments
    payload = {
        "session_id": session_id,
        "domain": settings.daily_domain,
    }

    if settings.audio_merger_endpoint:
        # Local dev: call audio-merger HTTP server directly
        try:
            resp = httpx.post(settings.audio_merger_endpoint, json=payload, timeout=300)
            resp.raise_for_status()
            logger.info(
                "Webhook: invoked audio merger HTTP for session=%s status=%d",
                session_id, resp.status_code,
            )
        except httpx.HTTPError as exc:
            logger.error(
                "Webhook: audio merger HTTP failed for session=%s — %s",
                session_id, exc,
            )
    elif settings.audio_merger_function_name:
        logger.info(
            "Webhook: invoking audio merger Lambda session=%s function=%s payload=%s",
            session_id, settings.audio_merger_function_name, payload,
        )
        lambda_client = boto3.client("lambda")
        lambda_client.invoke(
            FunctionName=settings.audio_merger_function_name,
            InvocationType="Event",  # Async — fire and forget
            Payload=json.dumps(payload),
        )
        logger.info(
            "Webhook: audio merger Lambda invoked (async) session=%s",
            session_id,
        )
    else:
        logger.warning(
            "Webhook: audio merger not configured — skipping invoke for session=%s",
            session_id,
        )


def on_recording_error(session_id: str, error_msg: str) -> None:
    """Webhook: recording.error — PRIMARY (not reconciliation).

    This is the ONLY way to know about server-side recording failures.
    All recording errors are terminal → mark session as error.
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
    # Build rejoin URLs from persisted tokens
    host_rejoin_url: str | None = None
    guest_rejoin_url: str | None = None
    if session.host_token:
        host_rejoin_url = (
            f"{settings.frontend_origin}/join/{session.session_id}"
            f"?t={session.host_token}&role=host"
        )
    if session.guest_token:
        guest_rejoin_url = (
            f"{settings.frontend_origin}/join/{session.session_id}"
            f"?t={session.guest_token}"
        )

    # Generate presigned URLs only for completed sessions (when audio URLs exist)
    host_audio_presigned: str | None = None
    guest_audio_presigned: str | None = None
    combined_audio_presigned: str | None = None
    if session.status == SessionStatus.COMPLETED:
        host_audio_presigned = generate_presigned_url(session.host_audio_url)
        guest_audio_presigned = generate_presigned_url(session.guest_audio_url)
        combined_audio_presigned = generate_presigned_url(session.combined_audio_url)

    return SessionResponse(
        session_id=session.session_id,
        status=session.status.value,
        host_user_id=session.host_user_id,
        host_name=session.host_name,
        guest_name=session.guest_name,
        guest_user_id=session.guest_user_id,
        recording_id=session.recording_id,
        recording_name=session.recording_name,
        daily_room_url=session.daily_room_url,
        participant_count=session.participant_count,
        active_participants=sorted(session.active_participants),
        participants=session.participants,
        connection_history=session.connection_history,
        recording_started_at=session.recording_started_at,
        recording_stopped_at=session.recording_stopped_at,
        pause_events=session.pause_events,
        s3_key=session.s3_key,
        s3_processed_prefix=session.s3_processed_prefix,
        host_audio_url=session.host_audio_url,
        guest_audio_url=session.guest_audio_url,
        combined_audio_url=session.combined_audio_url,
        host_audio_presigned_url=host_audio_presigned,
        guest_audio_presigned_url=guest_audio_presigned,
        combined_audio_presigned_url=combined_audio_presigned,
        host_rejoin_url=host_rejoin_url,
        guest_rejoin_url=guest_rejoin_url,
        error_message=session.error_message,
        cancellation_reason=session.cancellation_reason,
        created_at=session.created_at,
        updated_at=session.updated_at,
        room_expires_at=session.room_expires_at,
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
