"""Unit tests for client configuration."""

import os
import tempfile
from unittest.mock import patch

import pytest

from ddalab.core.config import AppConfig, ConfigManager


@pytest.fixture
def mock_env_vars():
    """Mock environment variables for testing."""
    with patch.dict(
        os.environ,
        {
            "SERVER_URL": "https://test-server:9000",
            "VERIFY_SSL": "false",
            "SSL_CA_CERT": "ssl/ca.pem",
        },
    ):
        yield


@pytest.fixture
def config_manager():
    """Create a config manager for testing."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        yield ConfigManager(config_dir=tmp_dir)


def test_app_config_defaults():
    """Test app config with default values."""
    config = AppConfig()
    assert config.server.host == "localhost"  # Default value
    assert config.server.port == "8001"  # Default value
    assert config.server.ssl_enabled is True  # Default value


def test_config_manager_initialization(tmp_path):
    """Test config manager initialization."""
    config_dir = tmp_path / "config"
    manager = ConfigManager(config_dir=str(config_dir))
    assert manager.config_dir == config_dir
    assert manager.config_file.exists()


def test_config_manager_save_load(tmp_path):
    """Test saving and loading configuration."""
    config_dir = tmp_path / "config"
    manager = ConfigManager(config_dir=str(config_dir))

    # Modify config
    manager.config.server.host = "test-host"
    manager.config.server.port = "9000"

    # Save config
    manager.save_config()

    # Create new manager to load from file
    new_manager = ConfigManager(config_dir=str(config_dir))
    assert new_manager.config.server.host == "test-host"
    assert new_manager.config.server.port == "9000"
