"""Common test fixtures and configuration."""

import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server.main import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        yield Path(tmp_dir)


@pytest.fixture
def test_file(temp_dir):
    """Create a test file for file operations."""
    file_path = temp_dir / "test_file.txt"
    with open(file_path, "w") as f:
        f.write("Test content")
    return file_path
