"""Recording entity model — represents a DynamoDB item in the recordings table.

A Recording is a fixed relationship between one host and one guest.
Multiple sessions can be created under a recording — each time the
host and guest sit down to record is a separate session.
"""

from dataclasses import dataclass


@dataclass
class Recording:
    """Core entity stored in the recordings DynamoDB table."""

    recording_id: str
    host_user_id: str
    host_name: str
    guest_user_id: str
    guest_name: str
    recording_name: str
    created_at: str
    updated_at: str

    def to_dynamo_item(self) -> dict[str, object]:
        """Serialize to a DynamoDB-compatible dict."""
        return {
            "recording_id": self.recording_id,
            "host_user_id": self.host_user_id,
            "host_name": self.host_name,
            "guest_user_id": self.guest_user_id,
            "guest_name": self.guest_name,
            "recording_name": self.recording_name,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dynamo_item(cls, item: dict[str, object]) -> "Recording":
        """Deserialize from a DynamoDB item dict."""
        return cls(
            recording_id=str(item["recording_id"]),
            host_user_id=str(item["host_user_id"]),
            host_name=str(item["host_name"]),
            guest_user_id=str(item["guest_user_id"]),
            guest_name=str(item["guest_name"]),
            recording_name=str(item["recording_name"]),
            created_at=str(item.get("created_at", "")),
            updated_at=str(item.get("updated_at", "")),
        )
