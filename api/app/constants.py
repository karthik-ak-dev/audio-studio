"""Shared constants — single source of truth for the API service."""

from enum import StrEnum


class SessionStatus(StrEnum):
    CREATED = "created"
    WAITING_FOR_GUEST = "waiting_for_guest"
    READY = "ready"
    RECORDING = "recording"
    PAUSED = "paused"
    PROCESSING = "processing"
    COMPLETED = "completed"
    ERROR = "error"



# Daily.co room configuration
MAX_PARTICIPANTS: int = 2
ROOM_EXPIRY_BUFFER_SEC: int = 7200
MAX_SESSION_DURATION_SEC: int = 3600
MIN_IDLE_TIMEOUT_SEC: int = 600
SFU_SWITCHOVER: float = 0.5

# Audio permissions
AUDIO_ONLY_SEND: list[str] = ["audio"]
HOST_ADMIN_PERMISSIONS: list[str] = ["participants", "transcription"]
GUEST_ADMIN_PERMISSIONS: list[str] = []

# DynamoDB
SESSION_TTL_DAYS: int = 30
SESSION_ID_LENGTH: int = 12
