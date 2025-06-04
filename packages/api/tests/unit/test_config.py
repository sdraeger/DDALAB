"""Unit tests for configuration management."""

import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from core.config import ConfigManager, Settings, get_server_settings


class TestSettings:
    """Test settings configuration."""

    def test_settings_creation_with_defaults(self):
        """Test creating settings with default values."""
        with patch.dict(
            os.environ,
            {
                "DDALAB_RELOAD": "false",
                "DDALAB_API_HOST": "localhost",
                "DDALAB_API_PORT": "8000",
                "DDALAB_INSTITUTION_NAME": "Test Institution",
                "DDALAB_DATA_DIR": "/tmp/data",
                "DDALAB_DDA_BINARY_PATH": "/usr/bin/dda",
                "DDALAB_DB_HOST": "localhost",
                "DDALAB_DB_PORT": "5432",
                "DDALAB_DB_NAME": "test_db",
                "DDALAB_DB_USER": "test_user",
                "DDALAB_DB_PASSWORD": "test_password",
                "DDALAB_JWT_SECRET_KEY": "test_secret",
                "DDALAB_JWT_ALGORITHM": "HS256",
                "DDALAB_AUTH_ENABLED": "true",
                "DDALAB_TOKEN_EXPIRATION_MINUTES": "30",
                "DDALAB_ALLOWED_DIRS": "/tmp,/data",
                "DDALAB_MINIO_HOST": "localhost:9000",
                "DDALAB_MINIO_ACCESS_KEY": "testkey",
                "DDALAB_MINIO_SECRET_KEY": "testsecret",
                "DDALAB_MINIO_BUCKET_NAME": "test-bucket",
                "DDALAB_OTLP_HOST": "localhost",
            },
        ):
            settings = Settings()

            assert settings.api_host == "localhost"
            assert settings.api_port == 8000
            assert settings.institution_name == "Test Institution"
            assert settings.auth_enabled is True
            assert settings.jwt_algorithm == "HS256"

    def test_allowed_dirs_parsing_development_mode(self):
        """Test allowed_dirs parsing in development mode."""
        with patch.dict(
            os.environ,
            {
                "DDALAB_RELOAD": "true",
                "DDALAB_ALLOWED_DIRS": "/tmp,/data,/home",
            },
        ):
            # Test parsing with reload=True (development mode)
            parsed = Settings.parse_allowed_dirs("/tmp,/data,/home")
            assert parsed == ["/tmp", "/data", "/home"]

    def test_allowed_dirs_parsing_production_mode(self):
        """Test allowed_dirs parsing in production mode."""
        with patch.dict(
            os.environ,
            {
                "DDALAB_RELOAD": "false",
            },
        ):
            # Test parsing with reload=False (production mode)
            parsed = Settings.parse_allowed_dirs(
                "host1:/container1:rw,host2:/container2:ro"
            )
            # In production mode, it returns a set due to set comprehension
            assert parsed == {"/container1", "/container2"}

    def test_allowed_dirs_parsing_empty_string(self):
        """Test allowed_dirs parsing with empty string."""
        with patch.dict(
            os.environ,
            {
                "DDALAB_RELOAD": "true",
            },
        ):
            parsed = Settings.parse_allowed_dirs("")
            assert parsed == []

    def test_allowed_dirs_parsing_invalid_format_production(self):
        """Test allowed_dirs parsing with simple format in production mode."""
        with patch.dict(
            os.environ,
            {
                "DDALAB_RELOAD": "false",
            },
        ):
            # Simple paths are now accepted as fallback in production mode
            parsed = Settings.parse_allowed_dirs("no_colons_here")
            assert parsed == {"no_colons_here"}

    def test_anonymize_edf_default(self):
        """Test that anonymize_edf defaults to False."""
        with patch.dict(os.environ, {}, clear=True):
            # Add minimum required environment variables
            with patch.dict(
                os.environ,
                {
                    "DDALAB_RELOAD": "false",
                    "DDALAB_API_HOST": "localhost",
                    "DDALAB_API_PORT": "8000",
                    "DDALAB_INSTITUTION_NAME": "Test",
                    "DDALAB_DATA_DIR": "/tmp",
                    "DDALAB_DDA_BINARY_PATH": "/usr/bin/dda",
                    "DDALAB_DB_HOST": "localhost",
                    "DDALAB_DB_PORT": "5432",
                    "DDALAB_DB_NAME": "test",
                    "DDALAB_DB_USER": "test",
                    "DDALAB_DB_PASSWORD": "test",
                    "DDALAB_JWT_SECRET_KEY": "test",
                    "DDALAB_JWT_ALGORITHM": "HS256",
                    "DDALAB_AUTH_ENABLED": "true",
                    "DDALAB_TOKEN_EXPIRATION_MINUTES": "30",
                    "DDALAB_ALLOWED_DIRS": "",
                    "DDALAB_MINIO_HOST": "localhost:9000",
                    "DDALAB_MINIO_ACCESS_KEY": "test",
                    "DDALAB_MINIO_SECRET_KEY": "test",
                    "DDALAB_MINIO_BUCKET_NAME": "test",
                    "DDALAB_OTLP_HOST": "localhost",
                },
            ):
                settings = Settings()
                assert settings.anonymize_edf is False


class TestConfigManager:
    """Test configuration manager."""

    def test_config_manager_initialization(self):
        """Test config manager initialization."""
        with tempfile.TemporaryDirectory() as temp_dir:
            config_dir = Path(temp_dir) / "config"
            manager = ConfigManager(str(config_dir))

            assert manager.config_dir == config_dir
            assert config_dir.exists()

    def test_save_and_load_config(self):
        """Test saving and loading configuration."""
        with tempfile.TemporaryDirectory() as temp_dir:
            manager = ConfigManager(temp_dir)

            # Create test settings
            test_config = {
                "reload": False,
                "api_host": "localhost",
                "api_port": 8000,
                "institution_name": "Test Institution",
                "data_dir": "/tmp/data",
                "anonymize_edf": False,
                "dda_binary_path": "/usr/bin/dda",
                "db_host": "localhost",
                "db_port": 5432,
                "db_name": "test_db",
                "db_user": "test_user",
                "db_password": "test_password",
                "jwt_secret_key": "test_secret",
                "jwt_algorithm": "HS256",
                "auth_enabled": True,
                "token_expiration_minutes": 30,
                "allowed_dirs": ["/tmp", "/data"],
                "minio_host": "localhost:9000",
                "minio_access_key": "testkey",
                "minio_secret_key": "testsecret",
                "minio_bucket_name": "test-bucket",
                "otlp_host": "localhost",
                "otlp_port": 4317,
            }

            # Save config
            settings = Settings(**test_config)
            manager.save_config(settings, "test_settings")

            # Load config
            loaded_settings = manager.load_config(Settings, "test_settings")

            assert loaded_settings is not None
            assert loaded_settings.api_host == "localhost"
            assert loaded_settings.api_port == 8000
            assert loaded_settings.auth_enabled is True

    def test_load_nonexistent_config(self):
        """Test loading a configuration that doesn't exist."""
        with tempfile.TemporaryDirectory() as temp_dir:
            manager = ConfigManager(temp_dir)

            result = manager.load_config(Settings, "nonexistent")
            assert result is None

    def test_update_config(self):
        """Test updating an existing configuration."""
        with tempfile.TemporaryDirectory() as temp_dir:
            manager = ConfigManager(temp_dir)

            # Create initial config
            initial_config = {
                "reload": False,
                "api_host": "localhost",
                "api_port": 8000,
                "institution_name": "Test Institution",
                "data_dir": "/tmp/data",
                "anonymize_edf": False,
                "dda_binary_path": "/usr/bin/dda",
                "db_host": "localhost",
                "db_port": 5432,
                "db_name": "test_db",
                "db_user": "test_user",
                "db_password": "test_password",
                "jwt_secret_key": "test_secret",
                "jwt_algorithm": "HS256",
                "auth_enabled": True,
                "token_expiration_minutes": 30,
                "allowed_dirs": ["/tmp"],
                "minio_host": "localhost:9000",
                "minio_access_key": "testkey",
                "minio_secret_key": "testsecret",
                "minio_bucket_name": "test-bucket",
                "otlp_host": "localhost",
                "otlp_port": 4317,
            }

            settings = Settings(**initial_config)
            manager.save_config(settings, "test_settings")

            # Update config
            updates = {"api_port": 9000, "auth_enabled": False}
            updated_settings = manager.update_config(settings, "test_settings", updates)

            assert updated_settings.api_port == 9000
            assert updated_settings.auth_enabled is False
            assert updated_settings.api_host == "localhost"  # Unchanged

    def test_get_config_path(self):
        """Test getting configuration file path."""
        with tempfile.TemporaryDirectory() as temp_dir:
            manager = ConfigManager(temp_dir)

            config_path = manager._get_config_path("test_config")
            expected_path = Path(temp_dir) / "test_config.json"

            assert config_path == expected_path


@pytest.mark.unit
class TestConfigurationIntegration:
    """Test configuration integration with the application."""

    @patch("core.config.Settings")
    def test_get_server_settings_caching(self, mock_settings):
        """Test that get_server_settings uses caching."""
        # Clear the cache
        get_server_settings.cache_clear()

        # Call twice
        get_server_settings()
        get_server_settings()

        # Should only instantiate Settings once due to caching
        assert mock_settings.call_count == 1

    def test_config_with_environment_variables(self):
        """Test configuration loading with environment variables."""
        with patch.dict(
            os.environ,
            {
                "DDALAB_API_HOST": "test.example.com",
                "DDALAB_API_PORT": "9999",
                "DDALAB_AUTH_ENABLED": "false",
            },
            clear=False,
        ):
            # Ensure we have minimum required env vars
            required_env = {
                "DDALAB_RELOAD": "false",
                "DDALAB_INSTITUTION_NAME": "Test",
                "DDALAB_DATA_DIR": "/tmp",
                "DDALAB_DDA_BINARY_PATH": "/usr/bin/dda",
                "DDALAB_DB_HOST": "localhost",
                "DDALAB_DB_PORT": "5432",
                "DDALAB_DB_NAME": "test",
                "DDALAB_DB_USER": "test",
                "DDALAB_DB_PASSWORD": "test",
                "DDALAB_JWT_SECRET_KEY": "test",
                "DDALAB_JWT_ALGORITHM": "HS256",
                "DDALAB_TOKEN_EXPIRATION_MINUTES": "30",
                "DDALAB_ALLOWED_DIRS": "",
                "DDALAB_MINIO_HOST": "localhost:9000",
                "DDALAB_MINIO_ACCESS_KEY": "test",
                "DDALAB_MINIO_SECRET_KEY": "test",
                "DDALAB_MINIO_BUCKET_NAME": "test",
                "DDALAB_OTLP_HOST": "localhost",
            }

            with patch.dict(os.environ, required_env):
                settings = Settings()

                assert settings.api_host == "test.example.com"
                assert settings.api_port == 9999
                assert settings.auth_enabled is False
