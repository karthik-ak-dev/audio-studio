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


class TestStopSession:
    def test_stop_session_not_found(self, test_client: TestClient, dynamodb_table: None) -> None:
        response = test_client.post("/sessions/nonexistent/stop")
        assert response.status_code == 404

    def test_stop_session_wrong_status(
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
        response = test_client.post(f"/sessions/{session_id}/stop")
        assert response.status_code == 400
