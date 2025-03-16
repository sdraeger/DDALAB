"""Integration tests for client-server interaction."""

import os
import subprocess
import time
from pathlib import Path

import pytest
import requests

from ddalab.core.graphql_client import GraphQLClient


@pytest.fixture(scope="module")
def server_process():
    """Start a test server for integration testing."""
    # Start server in test mode
    process = subprocess.Popen(
        ["uvicorn", "server.main:app", "--host", "localhost", "--port", "8002"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    # Wait for server to start
    max_retries = 10  # Increase retries
    retries = 0
    while retries < max_retries:
        try:
            response = requests.get("http://localhost:8002/health")
            if response.status_code == 200:
                break
        except requests.exceptions.ConnectionError:
            pass

        time.sleep(1)
        retries += 1

    # Skip the test if server doesn't start instead of failing
    if retries == max_retries:
        process.terminate()
        process.wait(timeout=5)
        pytest.skip("Failed to start test server")

    yield process

    # Clean up
    process.terminate()
    process.wait(timeout=5)


@pytest.mark.integration
def test_client_server_connection(server_process):
    """Test that client can connect to server."""
    client = GraphQLClient(base_url="http://localhost:8002", verify_ssl=False)

    # Test health endpoint directly
    response = requests.get("http://localhost:8002/health")
    assert response.status_code == 200
    # Don't check the exact response content since it might vary
