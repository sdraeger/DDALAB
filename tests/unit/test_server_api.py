"""Unit tests for server API endpoints."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from server.main import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@patch("server.main.get_server_settings")
def test_health_endpoint(mock_settings, client):
    """Test the health endpoint."""
    # Mock the server settings to return ssl_enabled=False
    mock_settings.return_value.ssl_enabled = False

    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "ssl": False}


def test_graphql_endpoint(client):
    """Test the GraphQL endpoint."""
    # Simple introspection query
    query = """
    {
        __schema {
            queryType {
                name
            }
        }
    }
    """

    response = client.post("/graphql", json={"query": query})

    assert response.status_code == 200
    assert "data" in response.json()
    assert "__schema" in response.json()["data"]


def test_options_request(client):
    """Test OPTIONS request for CORS preflight."""
    response = client.options(
        "/api/auth/token",
        headers={
            "Access-Control-Request-Method": "POST",
            "Origin": "http://localhost:3000",
        },
    )

    assert response.status_code == 200
    assert "access-control-allow-origin" in response.headers
    assert "access-control-allow-methods" in response.headers
