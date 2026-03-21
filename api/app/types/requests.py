"""Inbound request body types — strict Pydantic validation."""

from typing import Optional

from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    """Request body for POST /sessions."""
    host_user_id: str = Field(..., min_length=1, max_length=128)
    host_name: str = Field("", max_length=64)
    guest_name: str = Field("", max_length=64)
    guest_user_id: Optional[str] = Field(None, max_length=128)
    recording_id: Optional[str] = Field(None, max_length=64)


class CreateRecordingRequest(BaseModel):
    """Request body for POST /recordings."""
    host_user_id: str = Field(..., min_length=1, max_length=128)
    host_name: str = Field("", max_length=64)
    guest_user_id: str = Field(..., min_length=1, max_length=128)
    guest_name: str = Field("", max_length=64)
    recording_name: str = Field(..., min_length=1, max_length=128)


class JoinRequest(BaseModel):
    """FE sends after Daily SDK joins: user_id, connection_id, user_name."""

    user_id: str = Field(..., min_length=1, max_length=128)
    connection_id: str = Field(..., min_length=1, max_length=256)
    user_name: str = Field(..., min_length=1, max_length=64)


class LeaveRequest(BaseModel):
    """FE sends when user explicitly clicks Leave."""

    user_id: str = Field(..., min_length=1, max_length=128)


class CancelSessionRequest(BaseModel):
    """Request body for POST /sessions/{id}/cancel."""

    reason: str = Field(..., min_length=1, max_length=500)
