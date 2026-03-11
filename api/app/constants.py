"""Shared constants — single source of truth for the API service."""

from enum import StrEnum


class SessionStatus(StrEnum):
    CREATED = "created"
    WAITING_FOR_GUEST = "waiting_for_guest"
    RECORDING = "recording"
    PAUSED = "paused"
    STOPPING = "stopping"
    PROCESSING = "processing"
    COMPLETED = "completed"
    ERROR = "error"


# Status priority — higher number = further in lifecycle. Used to prevent
# stale webhooks from regressing state (e.g. a delayed "recording.started"
# arriving after the FE already moved the session to "processing").
STATUS_PRIORITY: dict[str, int] = {
    SessionStatus.CREATED: 0,
    SessionStatus.WAITING_FOR_GUEST: 1,
    SessionStatus.RECORDING: 2,
    SessionStatus.PAUSED: 2,       # Same level as recording (lateral move)
    SessionStatus.STOPPING: 3,
    SessionStatus.PROCESSING: 4,
    SessionStatus.COMPLETED: 5,
    SessionStatus.ERROR: 5,        # Terminal state, same level as completed
}


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
