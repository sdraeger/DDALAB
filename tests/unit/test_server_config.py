"""Unit tests for server configuration."""

import os
from unittest.mock import patch

import pytest

from server.core.config import get_server_settings


@pytest.fixture
def mock_env_vars():
    """Mock environment variables for testing."""
    with patch.dict(
        os.environ,
        {
            "DDALAB_HOST": "127.0.0.1",
            "DDALAB_PORT": "9000",
            "DDALAB_AUTH_ENABLED": "true",
            "DDALAB_SSL_ENABLED": "true",
            "DDALAB_SSL_CERT_PATH": "ssl/cert.pem",
            "DDALAB_SSL_KEY_PATH": "ssl/key.pem",
        },
    ):
        yield


def test_server_settings():
    """Test server settings with default values."""
    settings = get_server_settings()
    assert settings.host == "localhost"  # Default value
    assert settings.port == 8001  # Default value
    assert settings.auth_enabled is True  # Default value


@patch.dict(
    os.environ,
    {
        "DDALAB_HOST": "127.0.0.1",
        "DDALAB_PORT": "9000",
        "DDALAB_AUTH_ENABLED": "true",
        "DDALAB_SSL_ENABLED": "true",
        "DDALAB_SSL_CERT_PATH": "ssl/cert.pem",
        "DDALAB_SSL_KEY_PATH": "ssl/key.pem",
    },
)
def test_server_settings_with_env_vars():
    """Test server settings with environment variables."""
    # Clear the lru_cache to pick up new env vars
    get_server_settings.cache_clear()

    settings = get_server_settings()
    assert settings.host == "127.0.0.1"
    assert settings.port == 9000
    assert settings.auth_enabled is True
    assert settings.ssl_enabled is True
    assert settings.ssl_cert_path == "ssl/cert.pem"
    assert settings.ssl_key_path == "ssl/key.pem"
