"""Inbound request body types — strict Pydantic validation."""

from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    host_user_id: str = Field(..., min_length=1, max_length=128)
    host_name: str = Field(..., min_length=1, max_length=64)
    guest_name: str = Field(..., min_length=1, max_length=64)


class JoinRequest(BaseModel):
    """FE sends after Daily SDK joins: user_id, connection_id, user_name."""

    user_id: str = Field(..., min_length=1, max_length=128)
    connection_id: str = Field(..., min_length=1, max_length=256)
    user_name: str = Field(..., min_length=1, max_length=64)


class LeaveRequest(BaseModel):
    """FE sends when user explicitly clicks Leave."""

    user_id: str = Field(..., min_length=1, max_length=128)
