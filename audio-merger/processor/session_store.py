"""Minimal DynamoDB client for the processor — only updates status."""

import logging
from datetime import datetime, timezone

import boto3

from processor.config import config

logger = logging.getLogger(__name__)
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(config.SESSIONS_TABLE)


def update_status(session_id: str, status: str, **extra: str) -> None:
    """Update session status in DynamoDB."""
    update_expr = "SET #status = :status, updated_at = :now"
    values: dict = {
        ":status": status,
        ":now": datetime.now(timezone.utc).isoformat(),
    }
    names = {"#status": "status"}

    for key, value in extra.items():
        update_expr += f", {key} = :{key}"
        values[f":{key}"] = value

    table.update_item(
        Key={"session_id": session_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    logger.info(f"Session {session_id} → {status}")
