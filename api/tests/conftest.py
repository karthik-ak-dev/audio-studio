"""Shared test fixtures."""

import os
from typing import Generator
from unittest.mock import AsyncMock, patch

import boto3
import pytest
from moto import mock_aws
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env_setup() -> Generator[None, None, None]:
    """Set environment variables for tests."""
    env_vars: dict[str, str] = {
        "ENVIRONMENT": "test",
        "SESSIONS_TABLE": "audio-studio-sessions-test",
        "RECORDINGS_BUCKET": "audio-recordings-test",
        "DAILY_API_KEY": "test-daily-key",
        "DAILY_WEBHOOK_SECRET": "",
        "DAILY_DOMAIN": "test-domain",
    }
    with patch.dict(os.environ, env_vars):
        yield


@pytest.fixture()
def dynamodb_table() -> Generator[None, None, None]:
    """Create a mock DynamoDB sessions table."""
    with mock_aws():
        client = boto3.client("dynamodb", region_name="ap-south-1")
        client.create_table(
            TableName="audio-studio-sessions-test",
            KeySchema=[{"AttributeName": "session_id", "KeyType": "HASH"}],
            AttributeDefinitions=[
                {"AttributeName": "session_id", "AttributeType": "S"},
                {"AttributeName": "status", "AttributeType": "S"},
                {"AttributeName": "created_at", "AttributeType": "S"},
                {"AttributeName": "host_user_id", "AttributeType": "S"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "StatusIndex",
                    "KeySchema": [
                        {"AttributeName": "status", "KeyType": "HASH"},
                        {"AttributeName": "created_at", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                },
                {
                    "IndexName": "HostUserIndex",
                    "KeySchema": [
                        {"AttributeName": "host_user_id", "KeyType": "HASH"},
                        {"AttributeName": "created_at", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                },
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield


@pytest.fixture()
def mock_daily_client() -> Generator[AsyncMock, None, None]:
    """Mock the Daily.co client for tests that don't need real API calls."""
    mock: AsyncMock = AsyncMock()
    mock.create_room.return_value = {
        "name": "session-abc123",
        "url": "https://test-domain.daily.co/session-abc123",
    }
    mock.create_token.return_value = "mock-token-value"
    mock.start_recording.return_value = {"recordingId": "rec-123"}
    mock.stop_recording.return_value = {}
    mock.delete_room.return_value = None

    with patch("app.services.session_service.daily_client", mock):
        yield mock


@pytest.fixture()
def test_client() -> TestClient:
    """Create a FastAPI test client."""
    from app.main import app

    return TestClient(app)
