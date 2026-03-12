"""
Daily.co Webhook Route — receives events from Daily.co servers.

Role in the architecture:
  The frontend is the PRIMARY driver of session state (via /sessions/* endpoints).
  Webhooks serve as RECONCILIATION and SAFETY NET:

  - RECONCILIATION: Fill in data the FE couldn't set, or correct state if the
    FE's API call was missed (slow network, tab closed before call completed).
  - SAFETY NET: Catch events the FE cannot report — browser crashes, network
    drops, and server-side recording errors (recording.error).

Webhook events handled (4 events):
  participant.joined          → Reconciliation: same atomic join as FE endpoint
  participant.left            → Safety net: stale detection + auto-pause on crash
  recording.ready-to-download → Store s3_key for processing pipeline
  recording.error             → Primary: only source for server-side recording failures

Events NOT handled:
  recording.started  → No "room" field in payload, can't map to session.
                       Not needed: FE /start already writes everything.

Security:
  All webhook payloads are verified via HMAC-SHA256 signature.
  Daily.co sends: X-Webhook-Signature (Base64 HMAC) + X-Webhook-Timestamp.
  Verification: Base64-decode secret, message = "timestamp.body",
  compute HMAC-SHA256, Base64-encode result, compare.
  In local dev (no secret configured), verification is skipped.
"""

import base64
import hashlib
import hmac
import logging

from collections import OrderedDict

from fastapi import APIRouter, Request, HTTPException

from app.config import settings
from app.services import session_service
from app.types.webhooks import (
    ParticipantPayload,
    RecordingReadyPayload,
    RecordingErrorPayload,
)

logger: logging.Logger = logging.getLogger(__name__)
router: APIRouter = APIRouter()

# In-memory dedup cache for webhook event IDs.
# Daily.co can deliver duplicates; we skip events we've already processed.
# OrderedDict with max size acts as an LRU cache — sufficient for single-instance.
_DEDUP_MAX: int = 1000
_processed_events: OrderedDict[str, bool] = OrderedDict()


def _verify_signature(raw_body: str, signature: str, timestamp: str) -> bool:
    """Verify Daily.co webhook HMAC-SHA256 signature.

    Daily.co HMAC verification:
    1. Base64-decode the stored webhook secret
    2. Construct message: "{timestamp}.{raw_body}"
    3. Compute HMAC-SHA256 of message using decoded secret
    4. Base64-encode the HMAC digest
    5. Compare with the X-Webhook-Signature header

    Returns True (pass-through) if no secret is configured — this allows
    local development without webhook signature verification.
    """
    if not settings.daily_webhook_secret or settings.daily_webhook_secret == "none":
        return True

    try:
        secret_bytes: bytes = base64.b64decode(settings.daily_webhook_secret)
    except (ValueError, base64.binascii.Error):
        logger.error("Failed to Base64-decode DAILY_WEBHOOK_SECRET")
        return False

    message: bytes = f"{timestamp}.{raw_body}".encode()
    computed: str = base64.b64encode(
        hmac.new(secret_bytes, message, hashlib.sha256).digest()
    ).decode()

    return hmac.compare_digest(computed, signature)


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
    2. Parse event type and extract relevant fields per event type
    3. Delegate to the appropriate session_service webhook handler
    4. Return 200 OK (Daily.co expects a 2xx response)

    CRITICAL field mapping:
      payload.user_id    = OUR user_id from token (e.g. "host-174...")
      payload.session_id = Daily's per-connection ID (NOT our session_id!)
      payload.room       = Daily room name (participant events)
      payload.room_name  = Daily room name (recording events — different field!)
    """
    body: bytes = await request.body()
    raw_body: str = body.decode("utf-8")
    signature: str = request.headers.get("x-webhook-signature", "")
    timestamp: str = request.headers.get("x-webhook-timestamp", "")

    if not _verify_signature(raw_body, signature, timestamp):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    # Handle empty body or non-JSON — Daily sends a test request on webhook creation
    if not raw_body.strip():
        logger.info("Webhook: empty body (test ping), returning 200")
        return {"status": "ok"}

    try:
        raw: dict[str, object] = await request.json()
    except Exception:
        logger.info("Webhook: non-JSON body (test ping), returning 200")
        return {"status": "ok"}

    event_type: str = str(raw.get("type", ""))
    event_id: str = str(raw.get("id", ""))
    payload: dict[str, object] = raw.get("payload", {})  # type: ignore[assignment]

    # Handle test/ping events with no type
    if not event_type:
        logger.info("Webhook: no event type (test ping), returning 200")
        return {"status": "ok"}

    logger.info("Webhook received: type=%s id=%s", event_type, event_id)

    # Idempotency dedup — skip events we've already processed
    if event_id and event_id in _processed_events:
        logger.info("Webhook dedup: already processed id=%s, skipping", event_id)
        return {"status": "ok"}

    # ─── Participant events (use payload.room) ─────────────
    if event_type == "participant.joined":
        parsed = ParticipantPayload(**payload)
        session_id: str = _extract_session_id(parsed.room)
        logger.info(
            "Webhook participant.joined: session=%s user=%s conn=%s",
            session_id, parsed.user_id, parsed.session_id,
        )
        await session_service.on_participant_joined(
            session_id=session_id,
            user_id=parsed.user_id,
            connection_id=parsed.session_id,  # Daily's per-connection ID
            user_name=parsed.user_name,
        )

    elif event_type == "participant.left":
        parsed = ParticipantPayload(**payload)
        session_id = _extract_session_id(parsed.room)
        logger.info(
            "Webhook participant.left: session=%s user=%s conn=%s",
            session_id, parsed.user_id, parsed.session_id,
        )
        await session_service.on_participant_left(
            session_id=session_id,
            user_id=parsed.user_id,
            connection_id=parsed.session_id,  # Daily's per-connection ID
        )

    # ─── Recording events (use payload.room_name) ──────────
    elif event_type == "recording.ready-to-download":
        parsed_rec = RecordingReadyPayload(**payload)
        session_id = _extract_session_id(parsed_rec.room_name)
        logger.info(
            "Webhook recording.ready-to-download: session=%s recording=%s s3_key=%s",
            session_id, parsed_rec.recording_id, parsed_rec.s3_key,
        )
        await session_service.on_recording_ready_to_download(
            session_id=session_id,
            recording_id=parsed_rec.recording_id,
            s3_key=parsed_rec.s3_key,
        )

    elif event_type == "recording.error":
        parsed_err = RecordingErrorPayload(**payload)
        session_id = _extract_session_id(parsed_err.room_name)
        error_msg: str = parsed_err.error_msg or "Unknown recording error"
        logger.error(
            "Webhook recording.error: session=%s error=%s",
            session_id, error_msg,
        )
        session_service.on_recording_error(session_id, error_msg)

    else:
        logger.info("Webhook ignored: unhandled event type=%s", event_type)

    # Mark event as processed for dedup
    if event_id:
        _processed_events[event_id] = True
        if len(_processed_events) > _DEDUP_MAX:
            _processed_events.popitem(last=False)

    return {"status": "ok"}
