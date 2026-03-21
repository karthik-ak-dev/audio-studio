"""Topic entity model — represents a DynamoDB item in the topics table.

Topics group related sessions under a single identifier. They are optional —
sessions can exist without a topic. Topics are owned by the host who created them.
"""

from dataclasses import dataclass


@dataclass
class Topic:
    """Core entity stored in the topics DynamoDB table."""

    topic_id: str
    host_user_id: str
    topic_name: str
    created_at: str
    updated_at: str

    def to_dynamo_item(self) -> dict[str, object]:
        """Serialize to a DynamoDB-compatible dict."""
        return {
            "topic_id": self.topic_id,
            "host_user_id": self.host_user_id,
            "topic_name": self.topic_name,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dynamo_item(cls, item: dict[str, object]) -> "Topic":
        """Deserialize from a DynamoDB item dict."""
        return cls(
            topic_id=str(item["topic_id"]),
            host_user_id=str(item["host_user_id"]),
            topic_name=str(item["topic_name"]),
            created_at=str(item.get("created_at", "")),
            updated_at=str(item.get("updated_at", "")),
        )
