"""DynamoDB data access layer for sessions — pure CRUD, no business logic."""

import logging
from typing import Optional

import boto3
from mypy_boto3_dynamodb.service_resource import Table

from app.config import settings
from app.constants import SessionStatus
from app.models.session import Session
from app.utils.time import now_iso, compute_ttl

logger: logging.Logger = logging.getLogger(__name__)

dynamodb = boto3.resource("dynamodb")
table: Table = dynamodb.Table(settings.sessions_table)


def create(session: Session) -> Session:
    """Insert a new session into DynamoDB."""
    table.put_item(Item=session.to_dynamo_item())
    logger.info("Session created: %s", session.session_id)
    return session


def get_by_id(session_id: str) -> Optional[Session]:
    """Fetch a single session by primary key. Returns None if not found."""
    response = table.get_item(Key={"session_id": session_id})
    item: Optional[dict] = response.get("Item")
    if item is None:
        return None
    return Session.from_dynamo_item(item)


def update_status(session_id: str, status: SessionStatus, **extra_fields: str) -> None:
    """Update session status and optional extra fields."""
    update_expr: str = "SET #status = :status, updated_at = :now"
    expr_values: dict[str, str] = {
        ":status": status.value,
        ":now": now_iso(),
    }
    expr_names: dict[str, str] = {"#status": "status"}

    for key, value in extra_fields.items():
        safe_key: str = key.replace("-", "_")
        update_expr += f", {safe_key} = :{safe_key}"
        expr_values[f":{safe_key}"] = value

    table.update_item(
        Key={"session_id": session_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
    logger.info("Session %s status -> %s", session_id, status.value)


def increment_participant_count(session_id: str, delta: int) -> int:
    """Atomically increment participant_count and return the new value."""
    response = table.update_item(
        Key={"session_id": session_id},
        UpdateExpression="SET participant_count = participant_count + :delta, updated_at = :now",
        ExpressionAttributeValues={
            ":delta": delta,
            ":now": now_iso(),
        },
        ReturnValues="UPDATED_NEW",
    )
    count: int = int(response["Attributes"]["participant_count"])
    logger.info("Session %s participant_count -> %d", session_id, count)
    return count


def get_by_host(host_user_id: str, limit: int = 20) -> list[Session]:
    """Query sessions by host_user_id using the HostUserIndex GSI."""
    response = table.query(
        IndexName="HostUserIndex",
        KeyConditionExpression="host_user_id = :uid",
        ExpressionAttributeValues={":uid": host_user_id},
        ScanIndexForward=False,
        Limit=limit,
    )
    items: list[dict] = response.get("Items", [])
    return [Session.from_dynamo_item(item) for item in items]
