"""Tests for session routes."""

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient


class TestCreateSession:
    def test_create_session_success(
        self,
        test_client: TestClient,
        dynamodb_table: None,
        mock_daily_client: AsyncMock,
    ) -> None:
        response = test_client.post(
            "/sessions/",
            json={
                "host_user_id": "user-001",
                "host_name": "Alice",
                "guest_name": "Bob",
            },
        )
        assert response.status_code == 201
        data: dict = response.json()
        assert "session_id" in data
        assert "room_url" in data
        assert "host_token" in data
        assert "guest_token" in data
        assert "guest_join_url" in data

    def test_create_session_missing_fields(self, test_client: TestClient) -> None:
        response = test_client.post("/sessions/", json={})
        assert response.status_code == 422

    def test_create_session_empty_host_name(self, test_client: TestClient) -> None:
        response = test_client.post(
            "/sessions/",
            json={
                "host_user_id": "user-001",
                "host_name": "",
                "guest_name": "Bob",
            },
        )
        assert response.status_code == 422


class TestGetSession:
    def test_get_session_not_found(self, test_client: TestClient, dynamodb_table: None) -> None:
        response = test_client.get("/sessions/nonexistent")
        assert response.status_code == 404

    def test_get_session_success(
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

        response = test_client.get(f"/sessions/{session_id}")
        assert response.status_code == 200
        data: dict = response.json()
        assert data["session_id"] == session_id
        assert data["status"] == "created"
        assert data["host_name"] == "Alice"
        assert data["participant_count"] == 0
        assert data["active_participants"] == []
        assert data["participants"] == {}


class TestJoinSession:
    def test_join_session_not_found(self, test_client: TestClient, dynamodb_table: None) -> None:
        response = test_client.post(
            "/sessions/nonexistent/join",
            json={"user_id": "host-1", "connection_id": "conn-1", "user_name": "Alice"},
        )
        assert response.status_code == 404

    def test_join_first_participant(
        self,
        test_client: TestClient,
        dynamodb_table: None,
        mock_daily_client: AsyncMock,
    ) -> None:
        create_resp = test_client.post(
            "/sessions/",
            json={"host_user_id": "user-001", "host_name": "Alice", "guest_name": "Bob"},
        )
        session_id: str = create_resp.json()["session_id"]

        response = test_client.post(
            f"/sessions/{session_id}/join",
            json={"user_id": "user-001", "connection_id": "daily-conn-111", "user_name": "Alice"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "waiting_for_guest"

        # Verify session state
        session_resp = test_client.get(f"/sessions/{session_id}")
        data = session_resp.json()
        assert data["participant_count"] == 1
        assert "user-001" in data["active_participants"]
        assert data["participants"]["user-001"] == "Alice"

    def test_join_second_participant_moves_to_ready(
        self,
        test_client: TestClient,
        dynamodb_table: None,
        mock_daily_client: AsyncMock,
    ) -> None:
        create_resp = test_client.post(
            "/sessions/",
            json={"host_user_id": "user-001", "host_name": "Alice", "guest_name": "Bob"},
        )
        session_id: str = create_resp.json()["session_id"]

        # Host joins
        test_client.post(
            f"/sessions/{session_id}/join",
            json={"user_id": "user-001", "connection_id": "daily-conn-111", "user_name": "Alice"},
        )
        # Guest joins
        response = test_client.post(
            f"/sessions/{session_id}/join",
            json={"user_id": f"guest-{session_id}", "connection_id": "daily-conn-222", "user_name": "Bob"},
        )
        assert response.json()["status"] == "ready"

        session_resp = test_client.get(f"/sessions/{session_id}")
        assert session_resp.json()["participant_count"] == 2


class TestEndSession:
    def test_end_session_not_found(self, test_client: TestClient, dynamodb_table: None) -> None:
        response = test_client.post("/sessions/nonexistent/end")
        assert response.status_code == 404

    def test_end_session_wrong_status(
        self,
        test_client: TestClient,
        dynamodb_table: None,
        mock_daily_client: AsyncMock,
    ) -> None:
        create_resp = test_client.post(
            "/sessions/",
            json={"host_user_id": "user-001", "host_name": "Alice", "guest_name": "Bob"},
        )
        session_id: str = create_resp.json()["session_id"]
        # Session is in "created" status — can't end
        response = test_client.post(f"/sessions/{session_id}/end")
        assert response.status_code == 400


class TestLeaveSession:
    def test_leave_auto_pauses_during_recording(
        self,
        test_client: TestClient,
        dynamodb_table: None,
        mock_daily_client: AsyncMock,
    ) -> None:
        """When a participant leaves during recording, session should auto-pause."""
        create_resp = test_client.post(
            "/sessions/",
            json={"host_user_id": "user-001", "host_name": "Alice", "guest_name": "Bob"},
        )
        session_id: str = create_resp.json()["session_id"]

        # Both join
        test_client.post(
            f"/sessions/{session_id}/join",
            json={"user_id": "user-001", "connection_id": "conn-1", "user_name": "Alice"},
        )
        test_client.post(
            f"/sessions/{session_id}/join",
            json={"user_id": f"guest-{session_id}", "connection_id": "conn-2", "user_name": "Bob"},
        )

        # Start recording
        test_client.post(f"/sessions/{session_id}/start")

        # Guest leaves
        response = test_client.post(
            f"/sessions/{session_id}/leave",
            json={"user_id": f"guest-{session_id}"},
        )
        assert response.json()["status"] == "paused"  # Auto-pause, NOT processing

    def test_leave_regresses_ready_to_waiting(
        self,
        test_client: TestClient,
        dynamodb_table: None,
        mock_daily_client: AsyncMock,
    ) -> None:
        """When a participant leaves before recording, ready regresses to waiting_for_guest."""
        create_resp = test_client.post(
            "/sessions/",
            json={"host_user_id": "user-001", "host_name": "Alice", "guest_name": "Bob"},
        )
        session_id: str = create_resp.json()["session_id"]

        # Both join → ready
        test_client.post(
            f"/sessions/{session_id}/join",
            json={"user_id": "user-001", "connection_id": "conn-1", "user_name": "Alice"},
        )
        test_client.post(
            f"/sessions/{session_id}/join",
            json={"user_id": f"guest-{session_id}", "connection_id": "conn-2", "user_name": "Bob"},
        )

        # Guest leaves
        response = test_client.post(
            f"/sessions/{session_id}/leave",
            json={"user_id": f"guest-{session_id}"},
        )
        assert response.json()["status"] == "waiting_for_guest"
