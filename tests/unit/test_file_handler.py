"""Unit tests for file handler."""

import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from ddalab.core.config import ConfigManager
from ddalab.core.file_handler import FileHandler


@pytest.fixture
def config_manager():
    """Create a config manager for testing."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        config_dir = Path(tmp_dir) / "config"
        config_dir.mkdir(parents=True, exist_ok=True)
        manager = ConfigManager(config_dir=str(config_dir))
        yield manager


@pytest.fixture
def file_handler(config_manager):
    """Create a file handler for testing."""
    return FileHandler(config_manager=config_manager)


def test_file_handler_initialization(config_manager):
    """Test file handler initialization."""
    handler = FileHandler(config_manager=config_manager)
    assert handler.config_manager == config_manager


def test_list_files(file_handler, temp_dir):
    """Test listing files in a directory."""
    # Create test files
    (temp_dir / "file1.txt").touch()
    (temp_dir / "file2.txt").touch()
    os.mkdir(temp_dir / "subdir")
    (temp_dir / "subdir" / "file3.txt").touch()

    # Set the base_dir to temp_dir for testing
    file_handler.base_dir = temp_dir

    # List files in root directory
    files = file_handler.list_files()
    assert len(files) == 3
    assert any(f.name == "file1.txt" for f in files)
    assert any(f.name == "file2.txt" for f in files)
    assert any(f.name == "subdir" and f.is_dir for f in files)

    # List files in subdirectory
    files = file_handler.list_files("subdir")
    assert len(files) == 1
    assert files[0].name == "file3.txt"


def test_get_file_path(file_handler, temp_dir):
    """Test getting file path."""
    # Set the base_dir to temp_dir for testing
    file_handler.base_dir = temp_dir

    # Test with relative path
    path = file_handler.get_file_path("test.txt")
    assert path == temp_dir / "test.txt"

    # Test with absolute path
    abs_path = os.path.abspath("/tmp/test.txt")
    path = file_handler.get_file_path(abs_path)
    assert path == Path(abs_path)


@pytest.mark.asyncio
async def test_get_file_hash():
    """Test getting file hash."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        config_dir = Path(tmp_dir) / "config"
        config_dir.mkdir(parents=True, exist_ok=True)
        manager = ConfigManager(config_dir=str(config_dir))
        handler = FileHandler(config_manager=manager)

        # Mock aiohttp.ClientSession
        with patch("ddalab.core.file_handler.aiohttp.ClientSession") as mock_session:
            # Mock response for the hash endpoint
            mock_response = MagicMock()
            mock_response.status = 200
            mock_response.json = MagicMock()
            mock_response.json.return_value = {"hash": "test_hash_value"}

            mock_session_instance = MagicMock()
            mock_session_instance.__aenter__.return_value = mock_session_instance
            mock_session_instance.get.return_value.__aenter__.return_value = (
                mock_response
            )

            mock_session.return_value = mock_session_instance

            # Test getting file hash
            file_hash = await handler._get_file_hash("http://example.com/test.txt")
            assert file_hash == "test_hash_value"


def test_ensure_cache_dir(file_handler):
    """Test ensuring cache directory exists."""
    with patch("ddalab.core.file_handler.Path.mkdir") as mock_mkdir:
        file_handler._ensure_cache_dir()
        mock_mkdir.assert_called_once_with(parents=True, exist_ok=True)
