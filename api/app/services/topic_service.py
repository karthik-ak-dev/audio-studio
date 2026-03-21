"""Topic Service — business logic for topic management.

Topics are optional groupings for sessions. A host can create topics
and assign sessions to them. Topics are lightweight — just an ID, name,
and owner.

Architecture:
  Routes (thin HTTP layer) → Service (this file) → Repo (DynamoDB CRUD)
"""

import uuid
import logging

from app.constants import TOPIC_ID_LENGTH
from app.models.topic import Topic
from app.repos import topic_repo
from app.repos import session_repo
from app.types.requests import CreateTopicRequest
from app.types.responses import TopicResponse, TopicWithSessionsResponse, SessionResponse
from app.utils.time import now_iso

logger: logging.Logger = logging.getLogger(__name__)


def _generate_topic_id() -> str:
    return uuid.uuid4().hex[:TOPIC_ID_LENGTH]


def _to_topic_response(topic: Topic) -> TopicResponse:
    return TopicResponse(
        topic_id=topic.topic_id,
        host_user_id=topic.host_user_id,
        topic_name=topic.topic_name,
        created_at=topic.created_at,
        updated_at=topic.updated_at,
    )


async def create_topic(req: CreateTopicRequest) -> TopicResponse:
    """Create a new topic for grouping sessions."""
    topic_id: str = _generate_topic_id()
    now: str = now_iso()

    topic: Topic = Topic(
        topic_id=topic_id,
        host_user_id=req.host_user_id,
        topic_name=req.topic_name,
        created_at=now,
        updated_at=now,
    )
    topic_repo.create(topic)

    logger.info("Topic created: id=%s name=%s host=%s", topic_id, req.topic_name, req.host_user_id)
    return _to_topic_response(topic)


async def get_topic(topic_id: str) -> TopicResponse:
    """Retrieve a topic by ID."""
    topic: Topic | None = topic_repo.get_by_id(topic_id)
    if topic is None:
        raise TopicNotFoundError(topic_id)
    return _to_topic_response(topic)


async def get_topic_with_sessions(topic_id: str) -> TopicWithSessionsResponse:
    """Retrieve a topic and all sessions assigned to it."""
    from app.services.session_service import _to_session_response

    topic: Topic | None = topic_repo.get_by_id(topic_id)
    if topic is None:
        raise TopicNotFoundError(topic_id)

    sessions = session_repo.get_by_topic(topic_id)
    session_responses: list[SessionResponse] = [_to_session_response(s) for s in sessions]

    return TopicWithSessionsResponse(
        topic=_to_topic_response(topic),
        sessions=session_responses,
    )


async def list_topics_by_host(host_user_id: str, limit: int = 50) -> list[TopicResponse]:
    """List topics for a given host user, ordered by most recent first."""
    topics: list[Topic] = topic_repo.get_by_host(host_user_id, limit=limit)
    return [_to_topic_response(t) for t in topics]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Exceptions
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TopicNotFoundError(Exception):
    """Raised when a topic_id does not exist in DynamoDB."""

    def __init__(self, topic_id: str) -> None:
        self.topic_id: str = topic_id
        super().__init__(f"Topic not found: {topic_id}")
