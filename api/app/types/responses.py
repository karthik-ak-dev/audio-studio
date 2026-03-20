"""Outbound response types — strict Pydantic models."""

from typing import Any, Optional

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

    # Connection history — connectionId → userId (for audio-merger track mapping)
    connection_history: dict[str, str] = {}

    # Recording state
    recording_started_at: Optional[str] = None
    recording_stopped_at: Optional[str] = None
    pause_events: list[dict[str, Any]] = []

    # S3 data
    s3_key: Optional[str] = None
    s3_processed_prefix: Optional[str] = None

    # Processed audio file URLs (raw S3 URIs from DynamoDB)
    host_audio_url: Optional[str] = None
    guest_audio_url: Optional[str] = None
    combined_audio_url: Optional[str] = None

    # Presigned HTTPS URLs for browser playback/download
    host_audio_presigned_url: Optional[str] = None
    guest_audio_presigned_url: Optional[str] = None
    combined_audio_presigned_url: Optional[str] = None

    # Rejoin URLs (built from persisted tokens)
    host_rejoin_url: Optional[str] = None
    guest_rejoin_url: Optional[str] = None

    error_message: Optional[str] = None
    cancellation_reason: Optional[str] = None
    created_at: str
    updated_at: str
    room_expires_at: Optional[str] = None


class SessionActionResponse(BaseModel):
    """Lightweight response for state-changing actions."""
    session_id: str
    status: str


class SessionListResponse(BaseModel):
    """Paginated list of sessions for a host."""
    sessions: list[SessionResponse]
