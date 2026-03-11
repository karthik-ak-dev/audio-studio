"""Outbound response types — strict Pydantic models."""

from typing import Optional

from pydantic import BaseModel


class CreateSessionResponse(BaseModel):
    """Returned after creating a new session."""
    session_id: str
    room_url: str
    host_token: str
    guest_token: str
    guest_join_url: str


class SessionResponse(BaseModel):
    """Full session state returned by GET /sessions/{id}."""
    session_id: str
    status: str
    host_user_id: str
    host_name: str
    guest_name: str
    daily_room_url: Optional[str] = None

    # Participant tracking — derived from DynamoDB fields
    participant_count: int
    active_participants: list[str]
    participants: dict[str, str]

    # Recording state
    recording_segments: int
    recording_started_at: Optional[str] = None
    recording_stopped_at: Optional[str] = None

    # S3 data
    s3_key: Optional[str] = None
    s3_processed_prefix: Optional[str] = None

    error_message: Optional[str] = None
    created_at: str
    updated_at: str


class SessionActionResponse(BaseModel):
    """Lightweight response for state-changing actions."""
    session_id: str
    status: str


class SessionListResponse(BaseModel):
    """Paginated list of sessions for a host."""
    sessions: list[SessionResponse]
