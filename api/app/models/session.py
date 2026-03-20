"""Session entity model — represents the DynamoDB item shape.

Four participant tracking fields (see ARCHITECTURE.md):
  active_participants: Set — user IDs currently connected (ADD/DELETE = idempotent)
  participant_connections: Map — user_id → latest Daily connection_id (stale detection)
  participants: Map — user_id → display name (roster, write-once, never removed)
  connection_history: Map — connectionId → userId (append-only, used by audio-merger)
"""

from dataclasses import dataclass, field
from typing import Optional

from app.constants import SessionStatus


def _opt_str(item: dict[str, object], key: str) -> Optional[str]:
    """Return str(value) if key exists in item, else None."""
    val = item.get(key)
    return str(val) if val else None


@dataclass
class Session:  # pylint: disable=too-many-instance-attributes
    """Core entity stored in the sessions DynamoDB table."""

    session_id: str
    host_user_id: str
    host_name: str
    guest_name: str
    daily_room_name: str
    daily_room_url: str
    status: SessionStatus

    # Participant tracking (4 fields — see module docstring)
    active_participants: set[str] = field(default_factory=set)
    participant_connections: dict[str, str] = field(default_factory=dict)
    participants: dict[str, str] = field(default_factory=dict)
    connection_history: dict[str, str] = field(default_factory=dict)

    # Optimistic locking
    version: int = 0

    # Recording state
    recording_id: str = ""
    recording_started_at: Optional[str] = None
    recording_stopped_at: Optional[str] = None
    pause_events: list[dict[str, Optional[str]]] = field(default_factory=list)
    s3_key: Optional[str] = None

    # Daily.co tokens (persisted for rejoin)
    host_token: Optional[str] = None
    guest_token: Optional[str] = None

    # Post-processing
    s3_processed_prefix: Optional[str] = None
    host_audio_url: Optional[str] = None
    guest_audio_url: Optional[str] = None
    combined_audio_url: Optional[str] = None
    error_message: Optional[str] = None
    cancellation_reason: Optional[str] = None

    # Timestamp
    created_at: str = ""
    updated_at: str = ""
    room_expires_at: Optional[str] = None

    @property
    def participant_count(self) -> int:
        """Derive count from the active_participants set size."""
        return len(self.active_participants)

    def to_dynamo_item(self) -> dict[str, object]:
        """Serialize to a DynamoDB-compatible dict."""
        item: dict[str, object] = {
            "session_id": self.session_id,
            "host_user_id": self.host_user_id,
            "host_name": self.host_name,
            "guest_name": self.guest_name,
            "daily_room_name": self.daily_room_name,
            "daily_room_url": self.daily_room_url,
            "status": self.status.value,
            "version": self.version,
            "recording_id": self.recording_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

        if self.room_expires_at is not None:
            item["room_expires_at"] = self.room_expires_at

        # DynamoDB String Set — must be non-empty to store, omit if empty
        if self.active_participants:
            item["active_participants"] = self.active_participants
        # Maps — store even if empty (DynamoDB supports empty maps)
        item["participant_connections"] = self.participant_connections
        item["participants"] = self.participants
        item["connection_history"] = self.connection_history

        # Pause events — always include (empty list is valid)
        item["pause_events"] = self.pause_events

        # Optional fields — only include if set
        if self.recording_started_at is not None:
            item["recording_started_at"] = self.recording_started_at
        if self.recording_stopped_at is not None:
            item["recording_stopped_at"] = self.recording_stopped_at
        if self.host_token is not None:
            item["host_token"] = self.host_token
        if self.guest_token is not None:
            item["guest_token"] = self.guest_token
        if self.s3_key is not None:
            item["s3_key"] = self.s3_key
        if self.s3_processed_prefix is not None:
            item["s3_processed_prefix"] = self.s3_processed_prefix
        if self.host_audio_url is not None:
            item["host_audio_url"] = self.host_audio_url
        if self.guest_audio_url is not None:
            item["guest_audio_url"] = self.guest_audio_url
        if self.combined_audio_url is not None:
            item["combined_audio_url"] = self.combined_audio_url
        if self.error_message is not None:
            item["error_message"] = self.error_message
        if self.cancellation_reason is not None:
            item["cancellation_reason"] = self.cancellation_reason
        return item

    @classmethod
    def from_dynamo_item(cls, item: dict[str, object]) -> "Session":
        """Deserialize from a DynamoDB item dict."""
        # DynamoDB returns sets as Python sets, but empty sets are omitted
        raw_active = item.get("active_participants")
        active_set: set[str] = set(raw_active) if raw_active else set()  # type: ignore[arg-type]

        # DynamoDB returns maps as dicts
        raw_connections = item.get("participant_connections")
        connections: dict[str, str] = (
            dict(raw_connections) if raw_connections else {}  # type: ignore[arg-type]
        )

        raw_roster = item.get("participants")
        roster: dict[str, str] = dict(raw_roster) if raw_roster else {}  # type: ignore[arg-type]

        raw_history = item.get("connection_history")
        conn_history: dict[str, str] = dict(raw_history) if raw_history else {}  # type: ignore[arg-type]

        # Pause events — list of {paused_at, resumed_at} dicts
        raw_pause_events = item.get("pause_events")
        pause_events: list[dict[str, Optional[str]]] = (
            list(raw_pause_events) if raw_pause_events else []  # type: ignore[arg-type]
        )

        return cls(
            session_id=str(item["session_id"]),
            host_user_id=str(item["host_user_id"]),
            host_name=str(item["host_name"]),
            guest_name=str(item["guest_name"]),
            daily_room_name=str(item["daily_room_name"]),
            daily_room_url=str(item["daily_room_url"]),
            status=SessionStatus(str(item["status"])),
            active_participants=active_set,
            participant_connections=connections,
            participants=roster,
            connection_history=conn_history,
            version=int(item.get("version", 0)),  # type: ignore[arg-type]
            recording_id=str(item.get("recording_id", "")),
            pause_events=pause_events,
            recording_started_at=_opt_str(item, "recording_started_at"),
            recording_stopped_at=_opt_str(item, "recording_stopped_at"),
            host_token=_opt_str(item, "host_token"),
            guest_token=_opt_str(item, "guest_token"),
            s3_key=_opt_str(item, "s3_key"),
            s3_processed_prefix=_opt_str(item, "s3_processed_prefix"),
            host_audio_url=_opt_str(item, "host_audio_url"),
            guest_audio_url=_opt_str(item, "guest_audio_url"),
            combined_audio_url=_opt_str(item, "combined_audio_url"),
            error_message=_opt_str(item, "error_message"),
            cancellation_reason=_opt_str(item, "cancellation_reason"),
            created_at=str(item.get("created_at", "")),
            updated_at=str(item.get("updated_at", "")),
            room_expires_at=_opt_str(item, "room_expires_at"),
        )
