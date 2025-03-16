"""Unit tests for server health endpoint."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from server.main import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@patch("server.main.get_server_settings")
def test_health_check(mock_settings, client):
    """Test the health check endpoint."""
    # Mock the server settings to return ssl_enabled=False
    mock_settings.return_value.ssl_enabled = False

    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "ssl": False}
