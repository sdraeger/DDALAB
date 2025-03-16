"""Unit tests for GraphQL client."""

from unittest.mock import patch

import pytest
import requests
import requests_mock

from ddalab.core.graphql_client import GraphQLClient


@pytest.fixture
def mock_server():
    """Create a mock server for testing."""
    with requests_mock.Mocker() as m:
        # Mock the health check endpoint
        m.get("http://localhost:8001/health", json={"status": "ok", "ssl": False})

        # Mock GraphQL endpoint
        m.post("http://localhost:8001/graphql", json={"data": {"test": "success"}})

        yield m


def test_client_initialization():
    """Test client initialization with mocked server."""
    with requests_mock.Mocker() as m:
        m.get("http://localhost:8001/health", json={"status": "ok", "ssl": False})
        client = GraphQLClient(base_url="http://localhost:8001", verify_ssl=False)
        assert client.base_url == "http://localhost:8001"
        assert client.verify_ssl is False


@patch("ddalab.core.graphql_client.requests.get")
def test_server_connection_failure(mock_get):
    """Test client behavior when server connection fails."""
    # Mock the requests.get to raise an exception
    mock_get.side_effect = requests.exceptions.ConnectionError("Connection refused")

    # Should raise ConnectionError from the requests library, not the built-in Python one
    with pytest.raises(requests.exceptions.ConnectionError):
        GraphQLClient(base_url="http://localhost:8001", verify_ssl=False)
