"""
Daily.co Webhook Route — receives events from Daily.co servers.

Role in the architecture:
  The frontend is the PRIMARY driver of session state (via /sessions/* endpoints).
  Webhooks serve as RECONCILIATION and SAFETY NET:

  - RECONCILIATION: Fill in data the FE couldn't set, or correct state if the
    FE's API call was missed (slow network, tab closed before call completed).
  - SAFETY NET: Catch events the FE cannot report — browser crashes, network
    drops, and server-side recording errors (recording.error).

  All webhook handlers use STATUS_PRIORITY ordering to ensure they NEVER
  regress session state. A stale webhook arriving after the FE has already
  moved the session forward is silently skipped. See session_service.py
  for the _can_transition() guard logic.

Webhook events handled:
  participant.joined  → Reconciliation: increment count if FE missed join call
  participant.left    → Safety net: auto-stop recording on browser crash
  recording.started   → Reconciliation: fill in recording_started_at timestamp
  recording.stopped   → Reconciliation: ensure status reaches processing
  recording.error     → Primary: only source for server-side recording failures

Security:
  All webhook payloads are verified via HMAC-SHA256 signature using the
  DAILY_WEBHOOK_SECRET. In local dev (no secret configured), verification
  is skipped.
"""

import hashlib
import hmac
import logging

from fastapi import APIRouter, Request, HTTPException

from app.config import settings
from app.services import session_service

logger: logging.Logger = logging.getLogger(__name__)
router: APIRouter = APIRouter()


def _verify_signature(payload: bytes, signature: str) -> bool:
    """Verify Daily.co webhook HMAC-SHA256 signature.

    Returns True (pass-through) if no secret is configured — this allows
    local development without webhook signature verification.
    """
    if not settings.daily_webhook_secret:
        return True
    expected: str = hmac.new(
        settings.daily_webhook_secret.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def _extract_session_id(room_name: str) -> str:
    """Extract session_id from Daily.co room name format: 'session-{session_id}'.

    Daily.co includes the room name in every webhook payload. Our room naming
    convention (set in daily_client.create_room) embeds the session_id.
    """
    prefix: str = "session-"
    if room_name.startswith(prefix):
        return room_name[len(prefix):]
    return room_name


@router.post("/daily")
async def daily_webhook(request: Request) -> dict[str, str]:
    """Receive and dispatch Daily.co webhook events.

    Flow:
    1. Verify HMAC signature (reject if invalid)
    2. Parse event type and room name from payload
    3. Extract session_id from room name
    4. Delegate to the appropriate session_service webhook handler
    5. Return 200 OK (Daily.co expects a 2xx response)

    Each handler in session_service checks _can_transition() before
    modifying state, so stale/delayed webhooks are safely ignored.
    """
    body: bytes = await request.body()
    signature: str = request.headers.get("x-webhook-signature", "")

    if not _verify_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")

    raw: dict[str, object] = await request.json()
    event_type: str = str(raw.get("type", ""))
    payload: dict[str, object] = raw.get("payload", {})  # type: ignore[assignment]
    room_name: str = str(payload.get("room", ""))
    session_id: str = _extract_session_id(room_name)

    logger.info(
        "Webhook received: %s | room=%s | session=%s",
        event_type, room_name, session_id,
    )

    # Dispatch to service layer — each handler has its own guard logic
    if event_type == "participant.joined":
        await session_service.on_participant_joined(session_id, room_name)
    elif event_type == "participant.left":
        await session_service.on_participant_left(session_id, room_name)
    elif event_type == "recording.started":
        start_ts = str(payload.get("start_ts", ""))
        session_service.on_recording_started(session_id, start_ts)
    elif event_type == "recording.stopped":
        stopped_ts = str(payload.get("timestamp", ""))
        session_service.on_recording_stopped(session_id, stopped_ts)
    elif event_type == "recording.error":
        error_msg = str(payload.get("error", "Unknown error"))
        session_service.on_recording_error(session_id, error_msg)

    return {"status": "ok"}
