"""Inbound request body types — strict Pydantic validation."""

from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    host_user_id: str = Field(..., min_length=1, max_length=128)
    host_name: str = Field(..., min_length=1, max_length=64)
    guest_name: str = Field(..., min_length=1, max_length=64)
