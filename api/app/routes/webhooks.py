"""Daily.co webhook handler — thin route layer, delegates to service."""

import hashlib
import hmac
import logging

from fastapi import APIRouter, Request, HTTPException

from app.config import settings
from app.services import session_service

logger: logging.Logger = logging.getLogger(__name__)
router: APIRouter = APIRouter()


def _verify_signature(payload: bytes, signature: str) -> bool:
    """Verify Daily.co webhook HMAC-SHA256 signature."""
    if not settings.daily_webhook_secret:
        return True
    expected: str = hmac.new(
        settings.daily_webhook_secret.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def _extract_session_id(room_name: str) -> str:
    """Extract session_id from room name format: session-{session_id}."""
    prefix: str = "session-"
    if room_name.startswith(prefix):
        return room_name[len(prefix):]
    return room_name


@router.post("/daily")
async def daily_webhook(request: Request) -> dict[str, str]:
    """Handle all Daily.co webhook events."""
    body: bytes = await request.body()
    signature: str = request.headers.get("x-webhook-signature", "")

    if not _verify_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")

    raw: dict[str, object] = await request.json()
    event_type: str = str(raw.get("type", ""))
    payload: dict[str, object] = raw.get("payload", {})  # type: ignore[assignment]
    room_name: str = str(payload.get("room", ""))
    session_id: str = _extract_session_id(room_name)

    logger.info("Webhook: %s | room=%s | session=%s", event_type, room_name, session_id)

    if event_type == "participant.joined":
        await session_service.on_participant_joined(session_id, room_name)
    elif event_type == "participant.left":
        await session_service.on_participant_left(session_id, room_name)
    elif event_type == "recording.started":
        session_service.on_recording_started(session_id, str(payload.get("start_ts", "")))
    elif event_type == "recording.stopped":
        session_service.on_recording_stopped(session_id, str(payload.get("timestamp", "")))
    elif event_type == "recording.error":
        session_service.on_recording_error(session_id, str(payload.get("error", "Unknown recording error")))

    return {"status": "ok"}
