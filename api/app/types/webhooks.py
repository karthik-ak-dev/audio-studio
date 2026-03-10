"""Daily.co webhook event payload types."""

from typing import Optional

from pydantic import BaseModel


class WebhookPayload(BaseModel):
    room: Optional[str] = None
    participant_id: Optional[str] = None
    user_name: Optional[str] = None
    user_id: Optional[str] = None
    start_ts: Optional[float] = None
    timestamp: Optional[str] = None
    error: Optional[str] = None
    recording_id: Optional[str] = None


class DailyWebhookEvent(BaseModel):
    type: str
    payload: WebhookPayload
    event_ts: Optional[float] = None
    version: Optional[str] = None
