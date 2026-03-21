"""
Topic Routes — thin HTTP layer for topic management.

Endpoints:
  POST /topics/                        → Create a new topic
  GET  /topics/{topic_id}              → Get topic with its sessions
  GET  /topics/user/{host_user_id}     → List topics for a host
"""

import logging

from fastapi import APIRouter, HTTPException

from app.types.requests import CreateTopicRequest
from app.types.responses import TopicResponse, TopicWithSessionsResponse
from app.services.topic_service import TopicNotFoundError
from app.services import topic_service

logger: logging.Logger = logging.getLogger(__name__)
router: APIRouter = APIRouter()


# ─── Topic CRUD ──────────────────────────────────


@router.post("/", response_model=TopicResponse, status_code=201)
async def create_topic(req: CreateTopicRequest) -> TopicResponse:
    """Create a new topic for grouping sessions."""
    return await topic_service.create_topic(req)


@router.get("/{topic_id}", response_model=TopicWithSessionsResponse)
async def get_topic(topic_id: str) -> TopicWithSessionsResponse:
    """Get topic details with all its sessions."""
    try:
        return await topic_service.get_topic_with_sessions(topic_id)
    except TopicNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Topic not found") from exc


# ─── Query ───────────────────────────────────────


@router.get("/user/{host_user_id}")
async def list_user_topics(
    host_user_id: str, limit: int = 50,
) -> dict[str, list[TopicResponse]]:
    """List topics for a host user, ordered by most recent first."""
    topics = await topic_service.list_topics_by_host(host_user_id, limit=limit)
    return {"topics": topics}
