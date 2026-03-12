"""DynamoDB client for the processor — reads session info and updates status."""

import logging
from datetime import datetime, timezone
from typing import Optional

import boto3

from processor.config import config

logger: logging.Logger = logging.getLogger(__name__)

_kwargs: dict = {}
if config.DYNAMODB_ENDPOINT:
    _kwargs["endpoint_url"] = config.DYNAMODB_ENDPOINT

dynamodb = boto3.resource("dynamodb", **_kwargs)
table = dynamodb.Table(config.SESSIONS_TABLE)


def get_session(session_id: str) -> Optional[dict]:
    """Fetch full session record from DynamoDB."""
    response = table.get_item(Key={"session_id": session_id})
    return response.get("Item")


def update_status(session_id: str, status: str, **extra: str) -> None:
    """Update session status in DynamoDB."""
    update_expr = "SET #status = :status, updated_at = :now"
    values: dict = {
        ":status": status,
        ":now": datetime.now(timezone.utc).isoformat(),
    }
    names: dict[str, str] = {"#status": "status"}

    for key, value in extra.items():
        update_expr += f", {key} = :{key}"
        values[f":{key}"] = value

    table.update_item(
        Key={"session_id": session_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    logger.info("Session %s → %s", session_id, status)
