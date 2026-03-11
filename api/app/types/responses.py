"""Outbound response types — strict Pydantic models."""

from typing import Optional

from pydantic import BaseModel


class CreateSessionResponse(BaseModel):
    session_id: str
    room_url: str
    host_token: str
    guest_token: str
    guest_join_url: str


class SessionResponse(BaseModel):
    session_id: str
    status: str
    host_user_id: str
    host_name: str
    guest_name: str
    daily_room_url: Optional[str] = None
    participant_count: int
    recording_segments: int
    recording_started_at: Optional[str] = None
    recording_stopped_at: Optional[str] = None
    s3_processed_prefix: Optional[str] = None
    error_message: Optional[str] = None
    created_at: str
    updated_at: str


class SessionActionResponse(BaseModel):
    session_id: str
    status: str


class SessionListResponse(BaseModel):
    sessions: list[SessionResponse]
