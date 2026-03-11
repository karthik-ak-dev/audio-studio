"""Tests for webhook routes."""

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient


class TestDailyWebhook:
    def test_webhook_no_secret_passes_through(self, test_client: TestClient) -> None:
        """With no webhook secret configured, signature verification is skipped."""
        response = test_client.post(
            "/webhooks/daily",
            json={
                "type": "participant.joined",
                "id": "evt-123",
                "payload": {"room": "session-abc123", "user_id": "host-1",
                            "session_id": "daily-conn-111", "user_name": "Alice"},
            },
        )
        assert response.status_code == 200

    def test_webhook_participant_joined(
        self,
        test_client: TestClient,
        dynamodb_table: None,
        mock_daily_client: AsyncMock,
    ) -> None:
        """Webhook participant.joined should reconcile — add participant via atomic update."""
        create_resp = test_client.post(
            "/sessions/",
            json={"host_user_id": "user-001", "host_name": "Alice", "guest_name": "Bob"},
        )
        session_id: str = create_resp.json()["session_id"]
        room_name: str = f"session-{session_id}"

        # First participant joins via webhook
        response = test_client.post(
            "/webhooks/daily",
            json={
                "type": "participant.joined",
                "id": "evt-join-1",
                "payload": {
                    "room": room_name,
                    "user_id": "user-001",
                    "session_id": "daily-conn-111",
                    "user_name": "Alice",
                },
            },
        )
        assert response.status_code == 200

        # Verify session moved to waiting_for_guest
        session_resp = test_client.get(f"/sessions/{session_id}")
        data = session_resp.json()
        assert data["status"] == "waiting_for_guest"
        assert data["participant_count"] == 1
        assert "user-001" in data["active_participants"]

    def test_webhook_participant_joined_idempotent(
        self,
        test_client: TestClient,
        dynamodb_table: None,
        mock_daily_client: AsyncMock,
    ) -> None:
        """Duplicate participant.joined webhook should be a no-op."""
        create_resp = test_client.post(
            "/sessions/",
            json={"host_user_id": "user-001", "host_name": "Alice", "guest_name": "Bob"},
        )
        session_id: str = create_resp.json()["session_id"]
        room_name: str = f"session-{session_id}"

        # FE join first
        test_client.post(
            f"/sessions/{session_id}/join",
            json={"user_id": "user-001", "connection_id": "daily-conn-111", "user_name": "Alice"},
        )

        # Then webhook arrives (same data) — should be idempotent
        response = test_client.post(
            "/webhooks/daily",
            json={
                "type": "participant.joined",
                "id": "evt-join-dup",
                "payload": {
                    "room": room_name,
                    "user_id": "user-001",
                    "session_id": "daily-conn-111",
                    "user_name": "Alice",
                },
            },
        )
        assert response.status_code == 200

        # Still waiting_for_guest (not double-counted)
        session_resp = test_client.get(f"/sessions/{session_id}")
        assert session_resp.json()["participant_count"] == 1

    def test_webhook_participant_left_stale_skipped(
        self,
        test_client: TestClient,
        dynamodb_table: None,
        mock_daily_client: AsyncMock,
    ) -> None:
        """Stale participant.left webhook (old connection after refresh) should be skipped."""
        create_resp = test_client.post(
            "/sessions/",
            json={"host_user_id": "user-001", "host_name": "Alice", "guest_name": "Bob"},
        )
        session_id: str = create_resp.json()["session_id"]
        room_name: str = f"session-{session_id}"

        # Join with connection conn-111
        test_client.post(
            f"/sessions/{session_id}/join",
            json={"user_id": "user-001", "connection_id": "daily-conn-111", "user_name": "Alice"},
        )

        # Simulate refresh: rejoin with new connection conn-222
        test_client.post(
            f"/sessions/{session_id}/join",
            json={"user_id": "user-001", "connection_id": "daily-conn-222", "user_name": "Alice"},
        )

        # Webhook for OLD connection conn-111 arrives — should be STALE, skipped
        response = test_client.post(
            "/webhooks/daily",
            json={
                "type": "participant.left",
                "id": "evt-left-stale",
                "payload": {
                    "room": room_name,
                    "user_id": "user-001",
                    "session_id": "daily-conn-111",  # OLD connection
                },
            },
        )
        assert response.status_code == 200

        # User should still be in the session (not removed)
        session_resp = test_client.get(f"/sessions/{session_id}")
        assert session_resp.json()["participant_count"] == 1
        assert "user-001" in session_resp.json()["active_participants"]

    def test_webhook_recording_error(
        self,
        test_client: TestClient,
        dynamodb_table: None,
        mock_daily_client: AsyncMock,
    ) -> None:
        """recording.error webhook should set terminal error status."""
        create_resp = test_client.post(
            "/sessions/",
            json={"host_user_id": "user-001", "host_name": "Alice", "guest_name": "Bob"},
        )
        session_id: str = create_resp.json()["session_id"]
        room_name: str = f"session-{session_id}"

        response = test_client.post(
            "/webhooks/daily",
            json={
                "type": "recording.error",
                "id": "evt-err-1",
                "payload": {
                    "room_name": room_name,
                    "error_msg": "cloud-recording-error: disk full",
                    "instance_id": "inst-abc",
                },
            },
        )
        assert response.status_code == 200

        session_resp = test_client.get(f"/sessions/{session_id}")
        data = session_resp.json()
        assert data["status"] == "error"
        assert "disk full" in data["error_message"]

    def test_webhook_recording_ready_to_download(
        self,
        test_client: TestClient,
        dynamodb_table: None,
        mock_daily_client: AsyncMock,
    ) -> None:
        """recording.ready-to-download should store s3_key."""
        create_resp = test_client.post(
            "/sessions/",
            json={"host_user_id": "user-001", "host_name": "Alice", "guest_name": "Bob"},
        )
        session_id: str = create_resp.json()["session_id"]
        room_name: str = f"session-{session_id}"

        response = test_client.post(
            "/webhooks/daily",
            json={
                "type": "recording.ready-to-download",
                "id": "evt-rtd-1",
                "payload": {
                    "room_name": room_name,
                    "recording_id": "rec-xyz",
                    "s3_key": "ak-kgen/session-abc/1234567890",
                    "type": "raw-tracks",
                    "status": "finished",
                },
            },
        )
        assert response.status_code == 200

        session_resp = test_client.get(f"/sessions/{session_id}")
        assert session_resp.json()["s3_key"] == "ak-kgen/session-abc/1234567890"

    def test_webhook_unknown_event(self, test_client: TestClient) -> None:
        """Unknown webhook events should return 200 (acknowledged, ignored)."""
        response = test_client.post(
            "/webhooks/daily",
            json={"type": "unknown.event", "id": "evt-unk", "payload": {}},
        )
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
