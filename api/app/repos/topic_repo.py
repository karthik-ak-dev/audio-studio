"""DynamoDB data access layer for topics — pure CRUD, no business logic."""

import logging
from typing import Any, Optional

import boto3

from app.config import settings
from app.models.topic import Topic
from app.utils.time import now_iso

logger: logging.Logger = logging.getLogger(__name__)

dynamodb = boto3.resource(
    "dynamodb",
    **({"endpoint_url": settings.dynamodb_endpoint} if settings.dynamodb_endpoint else {}),
)
table: Any = dynamodb.Table(settings.topics_table)


def create(topic: Topic) -> Topic:
    """Insert a new topic into DynamoDB."""
    table.put_item(Item=topic.to_dynamo_item())
    logger.info("Topic created: %s", topic.topic_id)
    return topic


def get_by_id(topic_id: str) -> Optional[Topic]:
    """Fetch a single topic by primary key. Returns None if not found."""
    response = table.get_item(Key={"topic_id": topic_id})
    item: Optional[dict] = response.get("Item")
    if item is None:
        return None
    return Topic.from_dynamo_item(item)


def get_by_host(host_user_id: str, limit: int = 50) -> list[Topic]:
    """Query topics by host_user_id using the HostUserIndex GSI."""
    response = table.query(
        IndexName="HostUserIndex",
        KeyConditionExpression="host_user_id = :uid",
        ExpressionAttributeValues={":uid": host_user_id},
        ScanIndexForward=False,
        Limit=limit,
    )
    items: list[dict] = response.get("Items", [])
    return [Topic.from_dynamo_item(item) for item in items]
