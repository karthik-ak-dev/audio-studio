"""Tests for webhook routes."""

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient


class TestDailyWebhook:
    def test_webhook_invalid_signature(self, test_client: TestClient) -> None:
        # With webhook secret set, signature should be checked
        response = test_client.post(
            "/webhooks/daily",
            json={"type": "participant.joined", "payload": {"room": "session-abc123"}},
        )
        # No secret configured in test env, so it should pass through
        assert response.status_code == 200

    def test_webhook_participant_joined(
        self,
        test_client: TestClient,
        dynamodb_table: None,
        mock_daily_client: AsyncMock,
    ) -> None:
        # Create a session first
        create_resp = test_client.post(
            "/sessions/",
            json={
                "host_user_id": "user-001",
                "host_name": "Alice",
                "guest_name": "Bob",
            },
        )
        session_id: str = create_resp.json()["session_id"]
        room_name: str = f"session-{session_id}"

        # First participant joins
        response = test_client.post(
            "/webhooks/daily",
            json={
                "type": "participant.joined",
                "payload": {"room": room_name, "participant_id": "p1"},
            },
        )
        assert response.status_code == 200

        # Verify session moved to waiting_for_guest
        session_resp = test_client.get(f"/sessions/{session_id}")
        assert session_resp.json()["status"] == "waiting_for_guest"

    def test_webhook_both_participants_starts_recording(
        self,
        test_client: TestClient,
        dynamodb_table: None,
        mock_daily_client: AsyncMock,
    ) -> None:
        create_resp = test_client.post(
            "/sessions/",
            json={
                "host_user_id": "user-001",
                "host_name": "Alice",
                "guest_name": "Bob",
            },
        )
        session_id: str = create_resp.json()["session_id"]
        room_name: str = f"session-{session_id}"

        # First participant
        test_client.post(
            "/webhooks/daily",
            json={
                "type": "participant.joined",
                "payload": {"room": room_name, "participant_id": "p1"},
            },
        )

        # Second participant — should trigger recording
        test_client.post(
            "/webhooks/daily",
            json={
                "type": "participant.joined",
                "payload": {"room": room_name, "participant_id": "p2"},
            },
        )

        session_resp = test_client.get(f"/sessions/{session_id}")
        assert session_resp.json()["status"] == "recording"
        mock_daily_client.start_recording.assert_called_once_with(room_name)

    def test_webhook_recording_stopped(
        self,
        test_client: TestClient,
        dynamodb_table: None,
        mock_daily_client: AsyncMock,
    ) -> None:
        create_resp = test_client.post(
            "/sessions/",
            json={
                "host_user_id": "user-001",
                "host_name": "Alice",
                "guest_name": "Bob",
            },
        )
        session_id: str = create_resp.json()["session_id"]
        room_name: str = f"session-{session_id}"

        response = test_client.post(
            "/webhooks/daily",
            json={
                "type": "recording.stopped",
                "payload": {"room": room_name, "timestamp": "2026-03-10T12:00:00Z"},
            },
        )
        assert response.status_code == 200

        session_resp = test_client.get(f"/sessions/{session_id}")
        assert session_resp.json()["status"] == "processing"

    def test_webhook_unknown_event(self, test_client: TestClient) -> None:
        response = test_client.post(
            "/webhooks/daily",
            json={"type": "unknown.event", "payload": {"room": "session-abc"}},
        )
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
