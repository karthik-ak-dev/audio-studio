"""DynamoDB data access layer for sessions — pure CRUD, no business logic.

All participant operations use atomic DynamoDB primitives:
  ADD/DELETE on String Sets (idempotent)
  SET on Maps (overwrite-safe)

See ARCHITECTURE.md "DynamoDB Operations & Idempotency" for detailed examples.
"""

import logging
from typing import Any, Optional

import boto3
from botocore.exceptions import ClientError

from app.config import settings
from app.constants import SessionStatus
from app.models.session import Session
from app.utils.time import now_iso

logger: logging.Logger = logging.getLogger(__name__)

dynamodb = boto3.resource(
    "dynamodb",
    **({"endpoint_url": settings.dynamodb_endpoint} if settings.dynamodb_endpoint else {}),
)
table: Any = dynamodb.Table(settings.sessions_table)


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


def add_participant(
    session_id: str,
    user_id: str,
    connection_id: str,
    user_name: str,
) -> Session:
    """Atomically add a participant — idempotent, safe for duplicate calls.

    Three atomic operations in one update:
    1. ADD user_id to active_participants set (idempotent — no-op if already present)
    2. SET participant_connections[user_id] = connection_id (overwrites on reconnect)
    3. SET participants[user_id] = user_name (write-once via if_not_exists)

    Returns the full updated session (ALL_NEW) so the caller can read set size
    and decide on status transitions.
    """
    response = table.update_item(
        Key={"session_id": session_id},
        UpdateExpression="""
            ADD active_participants :user_set
            SET participant_connections.#uid = :conn_id,
                participants.#uid = if_not_exists(participants.#uid, :name),
                updated_at = :now
        """,
        ExpressionAttributeNames={"#uid": user_id},
        ExpressionAttributeValues={
            ":user_set": {user_id},
            ":conn_id": connection_id,
            ":name": user_name,
            ":now": now_iso(),
        },
        ReturnValues="ALL_NEW",
    )
    session = Session.from_dynamo_item(response["Attributes"])
    logger.info(
        "Participant added: session=%s user=%s conn=%s count=%d",
        session_id, user_id, connection_id, session.participant_count,
    )
    return session


def remove_participant(session_id: str, user_id: str) -> Session:
    """Atomically remove a participant from active set and connection map.

    Two atomic operations:
    1. DELETE user_id from active_participants set (idempotent — no-op if absent)
    2. REMOVE participant_connections[user_id]

    NOTE: participants roster is NOT removed — names stay for UI display
    even after disconnect.

    Returns the full updated session (ALL_NEW) for auto-pause logic.
    """
    response = table.update_item(
        Key={"session_id": session_id},
        UpdateExpression="""
            DELETE active_participants :user_set
            REMOVE participant_connections.#uid
            SET updated_at = :now
        """,
        ExpressionAttributeNames={"#uid": user_id},
        ExpressionAttributeValues={
            ":user_set": {user_id},
            ":now": now_iso(),
        },
        ReturnValues="ALL_NEW",
    )
    session = Session.from_dynamo_item(response["Attributes"])
    logger.info(
        "Participant removed: session=%s user=%s count=%d",
        session_id, user_id, session.participant_count,
    )
    return session


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


def conditional_update_status(
    session_id: str,
    new_status: SessionStatus,
    required_status: SessionStatus | list[SessionStatus],
    **extra_fields: str,
) -> bool:
    """Update status only if current status matches required_status.

    Uses DynamoDB ConditionExpression for atomic check-and-set.
    Returns True if update succeeded, False if condition failed.

    This prevents race conditions (e.g. double-click on Start Recording)
    and ensures state machine transitions are valid.
    """
    update_expr: str = "SET #status = :new_status, version = version + :one, updated_at = :now"
    expr_values: dict[str, Any] = {
        ":new_status": new_status.value,
        ":one": 1,
        ":now": now_iso(),
    }
    expr_names: dict[str, str] = {"#status": "status"}

    for key, value in extra_fields.items():
        safe_key: str = key.replace("-", "_")
        update_expr += f", {safe_key} = :{safe_key}"
        expr_values[f":{safe_key}"] = value

    # Build condition expression for single or multiple allowed statuses
    if isinstance(required_status, list):
        placeholders = [f":req_status_{i}" for i in range(len(required_status))]
        for ph, s in zip(placeholders, required_status):
            expr_values[ph] = s.value
        condition = f"#status IN ({', '.join(placeholders)})"
    else:
        expr_values[":required_status"] = required_status.value
        condition = "#status = :required_status"

    try:
        table.update_item(
            Key={"session_id": session_id},
            UpdateExpression=update_expr,
            ConditionExpression=condition,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
        )
        logger.info(
            "Conditional update: session=%s %s -> %s",
            session_id, required_status, new_status.value,
        )
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            logger.info(
                "Conditional update skipped: session=%s condition not met (required=%s, target=%s)",
                session_id, required_status, new_status.value,
            )
            return False
        raise


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
