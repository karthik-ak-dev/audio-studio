"""Session entity model — represents the DynamoDB item shape."""

from dataclasses import dataclass, field
from typing import Optional

from app.constants import SessionStatus


@dataclass
class Session:
    """Core entity stored in the sessions DynamoDB table."""

    session_id: str
    host_user_id: str
    host_name: str
    guest_name: str
    daily_room_name: str
    daily_room_url: str
    status: SessionStatus
    participant_count: int = 0
    recording_segments: int = 0
    recording_id: str = ""
    recording_started_at: Optional[str] = None
    recording_stopped_at: Optional[str] = None
    s3_processed_prefix: Optional[str] = None
    error_message: Optional[str] = None
    created_at: str = ""
    updated_at: str = ""
    ttl: int = 0

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
            "participant_count": self.participant_count,
            "recording_segments": self.recording_segments,
            "recording_id": self.recording_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "ttl": self.ttl,
        }
        if self.recording_started_at is not None:
            item["recording_started_at"] = self.recording_started_at
        if self.recording_stopped_at is not None:
            item["recording_stopped_at"] = self.recording_stopped_at
        if self.s3_processed_prefix is not None:
            item["s3_processed_prefix"] = self.s3_processed_prefix
        if self.error_message is not None:
            item["error_message"] = self.error_message
        return item

    @classmethod
    def from_dynamo_item(cls, item: dict[str, object]) -> "Session":
        """Deserialize from a DynamoDB item dict."""
        return cls(
            session_id=str(item["session_id"]),
            host_user_id=str(item["host_user_id"]),
            host_name=str(item["host_name"]),
            guest_name=str(item["guest_name"]),
            daily_room_name=str(item["daily_room_name"]),
            daily_room_url=str(item["daily_room_url"]),
            status=SessionStatus(str(item["status"])),
            participant_count=int(item.get("participant_count", 0)),  # type: ignore[arg-type]
            recording_segments=int(item.get("recording_segments", 0)),  # type: ignore[arg-type]
            recording_id=str(item.get("recording_id", "")),
            recording_started_at=str(item["recording_started_at"]) if item.get("recording_started_at") else None,
            recording_stopped_at=str(item["recording_stopped_at"]) if item.get("recording_stopped_at") else None,
            s3_processed_prefix=str(item["s3_processed_prefix"]) if item.get("s3_processed_prefix") else None,
            error_message=str(item["error_message"]) if item.get("error_message") else None,
            created_at=str(item.get("created_at", "")),
            updated_at=str(item.get("updated_at", "")),
            ttl=int(item.get("ttl", 0)),  # type: ignore[arg-type]
        )
