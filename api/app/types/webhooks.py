"""Daily.co webhook event payload types — matches actual Daily.co payloads.

CRITICAL field mapping (Daily.co naming is confusing):
  payload.user_id    = The user_id WE set in the meeting token (our app user ID)
  payload.session_id = Daily's per-connection ID (changes on every reconnect/refresh)
                       — NOT our session_id! We use this for stale webhook detection.
  payload.room       = Daily room name (participant events) — "session-{our_session_id}"
  payload.room_name  = Daily room name (recording events) — different field name!
"""

from typing import Optional

from pydantic import BaseModel


# ─── Participant event payloads ────────────────────

class ParticipantPayload(BaseModel):
    """Payload for participant.joined and participant.left webhooks."""

    room: str = ""
    user_id: str = ""                           # OUR user_id from token
    session_id: str = ""                        # Daily's per-connection ID (NOT our session_id)
    user_name: str = ""
    owner: bool = False
    joined_at: Optional[float] = None
    duration: Optional[float] = None


# ─── Recording event payloads ─────────────────────

class RecordingReadyPayload(BaseModel):
    """Payload for recording.ready-to-download webhook."""

    room_name: str = ""                         # NOTE: "room_name" not "room"
    recording_id: str = ""
    s3_key: str = ""
    type: str = ""                              # e.g. "raw-tracks"
    status: str = ""                            # e.g. "finished"
    start_ts: Optional[float] = None
    duration: Optional[int] = None
    max_participants: Optional[int] = None


class RecordingErrorPayload(BaseModel):
    """Payload for recording.error webhook."""

    room_name: str = ""                         # NOTE: "room_name" not "room"
    error_msg: str = ""                         # NOTE: "error_msg" not "error"
    instance_id: str = ""
    timestamp: Optional[str] = None
