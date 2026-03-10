"""Daily.co REST API client — all external Daily interactions go through here."""

import time
import logging
from typing import Optional

import httpx

from app.config import settings
from app.constants import (
    MAX_PARTICIPANTS,
    ROOM_EXPIRY_BUFFER_SEC,
    MAX_SESSION_DURATION_SEC,
    MIN_IDLE_TIMEOUT_SEC,
    SFU_SWITCHOVER,
    AUDIO_ONLY_SEND,
    HOST_ADMIN_PERMISSIONS,
    GUEST_ADMIN_PERMISSIONS,
)

logger: logging.Logger = logging.getLogger(__name__)


class DailyClient:
    """Async client for the Daily.co REST API."""

    def __init__(self) -> None:
        self.base_url: str = settings.daily_api_base
        self.headers: dict[str, str] = {
            "Authorization": f"Bearer {settings.daily_api_key}",
            "Content-Type": "application/json",
        }

    async def create_room(self, session_id: str) -> dict[str, object]:
        """Create an audio-only, 2-person private room."""
        room_name: str = f"session-{session_id}"
        async with httpx.AsyncClient() as client:
            response: httpx.Response = await client.post(
                f"{self.base_url}/rooms",
                headers=self.headers,
                json={
                    "name": room_name,
                    "privacy": "private",
                    "properties": {
                        "max_participants": MAX_PARTICIPANTS,
                        "enable_recording": "raw-tracks",
                        "start_video_off": True,
                        "enable_screenshare": False,
                        "enable_chat": False,
                        "enable_emoji_reactions": False,
                        "eject_at_room_exp": True,
                        "exp": int(time.time()) + ROOM_EXPIRY_BUFFER_SEC,
                        "sfu_switchover": SFU_SWITCHOVER,
                    },
                },
                timeout=10.0,
            )
            response.raise_for_status()
            data: dict[str, object] = response.json()
            logger.info("Room created: %s", room_name)
            return data

    async def create_token(
        self,
        room_name: str,
        user_id: str,
        user_name: str,
        is_owner: bool,
    ) -> str:
        """Generate a meeting token with audio-only permissions."""
        permissions: dict[str, object] = {
            "hasPresence": True,
            "canSend": AUDIO_ONLY_SEND,
            "canAdmin": HOST_ADMIN_PERMISSIONS if is_owner else GUEST_ADMIN_PERMISSIONS,
        }

        async with httpx.AsyncClient() as client:
            response: httpx.Response = await client.post(
                f"{self.base_url}/meeting-tokens",
                headers=self.headers,
                json={
                    "properties": {
                        "room_name": room_name,
                        "is_owner": is_owner,
                        "user_name": user_name,
                        "user_id": user_id,
                        "exp": int(time.time()) + ROOM_EXPIRY_BUFFER_SEC,
                        "eject_at_token_exp": True,
                        "enable_recording": "raw-tracks",
                        "permissions": permissions,
                    }
                },
                timeout=10.0,
            )
            response.raise_for_status()
            token: str = response.json()["token"]
            logger.info("Token created for %s (owner=%s)", user_name, is_owner)
            return token

    async def start_recording(self, room_name: str) -> dict[str, object]:
        """Start raw-tracks audio-only recording."""
        async with httpx.AsyncClient() as client:
            response: httpx.Response = await client.post(
                f"{self.base_url}/rooms/{room_name}/recordings/start",
                headers=self.headers,
                json={
                    "type": "raw-tracks",
                    "layout": {"preset": "raw-tracks-audio-only"},
                    "maxDuration": MAX_SESSION_DURATION_SEC,
                    "minIdleTimeOut": MIN_IDLE_TIMEOUT_SEC,
                },
                timeout=10.0,
            )
            response.raise_for_status()
            data: dict[str, object] = response.json()
            logger.info("Recording started for room: %s, id: %s", room_name, data.get("recordingId"))
            return data

    async def stop_recording(self, room_name: str) -> Optional[dict[str, object]]:
        """Stop the current recording. Returns None if no active recording."""
        async with httpx.AsyncClient() as client:
            response: httpx.Response = await client.post(
                f"{self.base_url}/rooms/{room_name}/recordings/stop",
                headers=self.headers,
                timeout=10.0,
            )
            if response.status_code == 400:
                logger.warning("No active recording to stop for room: %s", room_name)
                return None
            response.raise_for_status()
            logger.info("Recording stopped for room: %s", room_name)
            return response.json()

    async def delete_room(self, room_name: str) -> None:
        """Delete a room. Silently ignores 404 (already deleted)."""
        async with httpx.AsyncClient() as client:
            response: httpx.Response = await client.delete(
                f"{self.base_url}/rooms/{room_name}",
                headers=self.headers,
                timeout=10.0,
            )
            if response.status_code == 404:
                logger.info("Room already deleted: %s", room_name)
                return
            response.raise_for_status()
            logger.info("Room deleted: %s", room_name)

    async def get_recording(self, recording_id: str) -> dict[str, object]:
        """Get recording metadata including S3 keys and track info."""
        async with httpx.AsyncClient() as client:
            response: httpx.Response = await client.get(
                f"{self.base_url}/recordings/{recording_id}",
                headers=self.headers,
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()


daily_client: DailyClient = DailyClient()
