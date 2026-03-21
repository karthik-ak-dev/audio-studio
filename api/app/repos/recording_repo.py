"""DynamoDB data access layer for recordings — pure CRUD, no business logic."""

import logging
from typing import Any, Optional

import boto3

from app.config import settings
from app.models.recording import Recording

logger: logging.Logger = logging.getLogger(__name__)

dynamodb = boto3.resource(
    "dynamodb",
    **({"endpoint_url": settings.dynamodb_endpoint} if settings.dynamodb_endpoint else {}),
)
table: Any = dynamodb.Table(settings.recordings_table)


def create(recording: Recording) -> Recording:
    """Insert a new recording into DynamoDB."""
    table.put_item(Item=recording.to_dynamo_item())
    logger.info("Recording created: %s", recording.recording_id)
    return recording


def get_by_id(recording_id: str) -> Optional[Recording]:
    """Fetch a single recording by primary key. Returns None if not found."""
    response = table.get_item(Key={"recording_id": recording_id})
    item: Optional[dict] = response.get("Item")
    if item is None:
        return None
    return Recording.from_dynamo_item(item)


def get_by_guest(guest_user_id: str, limit: int = 50) -> list[Recording]:
    """Query recordings by guest_user_id using the GuestUserIndex GSI."""
    response = table.query(
        IndexName="GuestUserIndex",
        KeyConditionExpression="guest_user_id = :uid",
        ExpressionAttributeValues={":uid": guest_user_id},
        ScanIndexForward=False,
        Limit=limit,
    )
    items: list[dict] = response.get("Items", [])
    return [Recording.from_dynamo_item(item) for item in items]


def get_by_host(host_user_id: str, limit: int = 50) -> list[Recording]:
    """Query recordings by host_user_id using the HostUserIndex GSI."""
    response = table.query(
        IndexName="HostUserIndex",
        KeyConditionExpression="host_user_id = :uid",
        ExpressionAttributeValues={":uid": host_user_id},
        ScanIndexForward=False,
        Limit=limit,
    )
    items: list[dict] = response.get("Items", [])
    return [Recording.from_dynamo_item(item) for item in items]


