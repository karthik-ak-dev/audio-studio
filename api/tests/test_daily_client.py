"""Tests for Daily.co client."""

import pytest
import httpx
from unittest.mock import AsyncMock, patch

from app.services.daily_client import DailyClient


class TestDailyClient:
    @pytest.fixture()
    def client(self) -> DailyClient:
        return DailyClient()

    @pytest.mark.asyncio
    async def test_create_room(self, client: DailyClient) -> None:
        mock_response: AsyncMock = AsyncMock(spec=httpx.Response)
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "name": "session-abc123",
            "url": "https://test-domain.daily.co/session-abc123",
        }
        mock_response.raise_for_status = AsyncMock()

        with patch("httpx.AsyncClient.post", return_value=mock_response):
            result: dict[str, object] = await client.create_room("abc123")
            assert result["name"] == "session-abc123"
            assert "url" in result

    @pytest.mark.asyncio
    async def test_create_token(self, client: DailyClient) -> None:
        mock_response: AsyncMock = AsyncMock(spec=httpx.Response)
        mock_response.status_code = 200
        mock_response.json.return_value = {"token": "eyJ-mock-token"}
        mock_response.raise_for_status = AsyncMock()

        with patch("httpx.AsyncClient.post", return_value=mock_response):
            token: str = await client.create_token(
                room_name="session-abc123",
                user_id="user-001",
                user_name="Alice",
                is_owner=True,
            )
            assert token == "eyJ-mock-token"

    @pytest.mark.asyncio
    async def test_stop_recording_no_active(self, client: DailyClient) -> None:
        mock_response: AsyncMock = AsyncMock(spec=httpx.Response)
        mock_response.status_code = 400

        with patch("httpx.AsyncClient.post", return_value=mock_response):
            result = await client.stop_recording("session-abc123")
            assert result is None

    @pytest.mark.asyncio
    async def test_delete_room_already_deleted(self, client: DailyClient) -> None:
        mock_response: AsyncMock = AsyncMock(spec=httpx.Response)
        mock_response.status_code = 404

        with patch("httpx.AsyncClient.delete", return_value=mock_response):
            await client.delete_room("session-abc123")  # should not raise
