"""Shared constants — single source of truth for the API service."""

from enum import StrEnum


class SessionStatus(StrEnum):
    """Valid session lifecycle states."""
    CREATED = "created"
    WAITING_FOR_GUEST = "waiting_for_guest"
    READY = "ready"
    RECORDING = "recording"
    PAUSED = "paused"
    PROCESSING = "processing"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    ERROR = "error"



# Daily.co room configuration
MAX_PARTICIPANTS: int = 2
ROOM_EXPIRY_SEC: int = 7200  # 2 hours — room + recording expire together
MIN_IDLE_TIMEOUT_SEC: int = 300  # 5 minutes — Daily auto-stops recording after this idle period
SFU_SWITCHOVER: float = 0.5

# Audio permissions
AUDIO_ONLY_SEND: list[str] = ["audio"]
HOST_ADMIN_PERMISSIONS: list[str] = ["participants", "transcription"]
GUEST_ADMIN_PERMISSIONS: list[str] = []

# DynamoDB
SESSION_ID_LENGTH: int = 12
RECORDING_ID_LENGTH: int = 8

# S3 presigned URLs — max for Lambda IAM role is ~12h; 6h is a safe default
PRESIGNED_URL_EXPIRY_SEC: int = 6 * 60 * 60  # 6 hours
