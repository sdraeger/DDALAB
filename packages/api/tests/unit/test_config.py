"""Unit tests for configuration management."""

import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from core.environment import (  # Updated import
    APISettings,
    AuthSettings,
    CacheSettings,
    DDASettings,
    DatabaseSettings,
    EnvironmentConfigProvider,
    ObservabilitySettings,
    ServiceSettings,
    StorageSettings,
    get_config_service,
)
from pydantic import ValidationError


@pytest.fixture(autouse=True)
def clear_config_cache():
    """Fixture to clear the configuration service cache before each test."""
    get_config_service().reload_settings()


class TestSettingsClasses:
    """Test individual settings classes for proper environment variable loading and validation."""

    @pytest.mark.parametrize(
        "env_vars,expected_api_host,expected_api_port,expected_reload",
        [
            (
                {
                    "DDALAB_API_HOST": "localhost",
                    "DDALAB_API_PORT": "8000",
                    "DDALAB_RELOAD": "true",
                },
                "localhost",
                8000,
                True,
            ),
            (
                {"DDALAB_API_HOST": "127.0.0.1", "DDALAB_API_PORT": "9000"},
                "127.0.0.1",
                9000,
                False,  # Default value
            ),
        ],
    )
    def test_api_settings(
        self, env_vars, expected_api_host, expected_api_port, expected_reload
    ):
        with patch.dict(os.environ, env_vars, clear=True):
            settings = APISettings()
            assert settings.api_host == expected_api_host
            assert settings.api_port == expected_api_port
            assert settings.reload == expected_reload

    @pytest.mark.parametrize(
        "env_vars,expected_db_host",
        [
            (
                {
                    "DDALAB_DB_HOST": "db",
                    "DDALAB_DB_USER": "u",
                    "DDALAB_DB_PASSWORD": "p",
                },
                "db",
            ),
        ],
    )
    def test_database_settings(self, env_vars, expected_db_host):
        with patch.dict(os.environ, env_vars, clear=True):
            settings = DatabaseSettings()
            assert settings.db_host == expected_db_host
            assert "u:p@db:5432/ddalab" in settings.connection_url

    def test_database_settings_missing_required(self):
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(ValidationError):
                DatabaseSettings()

    @pytest.mark.parametrize(
        "env_vars,expected_auth_mode,expected_token_exp",
        [
            (
                {
                    "DDALAB_JWT_SECRET_KEY": "s",
                    "DDALAB_AUTH_MODE": "local",
                    "DDALAB_TOKEN_EXPIRATION_MINUTES": "60",
                },
                "local",
                60,
            ),
            ({"DDALAB_JWT_SECRET_KEY": "s"}, "multi-user", 10080),  # Default values
        ],
    )
    def test_auth_settings(self, env_vars, expected_auth_mode, expected_token_exp):
        with patch.dict(os.environ, env_vars, clear=True):
            settings = AuthSettings()
            assert settings.auth_mode == expected_auth_mode
            assert settings.token_expiration_minutes == expected_token_exp
            assert settings.jwt_algorithm == "HS256"  # Default

    def test_auth_settings_missing_secret_key(self):
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(ValidationError):
                AuthSettings()

    @pytest.mark.parametrize(
        "env_vars,expected_data_dir,expected_allowed_dirs",
        [
            (
                {
                    "DDALAB_MINIO_HOST": "m",
                    "DDALAB_MINIO_ACCESS_KEY": "a",
                    "DDALAB_MINIO_SECRET_KEY": "s",
                    "DDALAB_DATA_DIR": "/data",
                    "DDALAB_ALLOWED_DIRS": "/a,/b",
                },
                "/data",
                ["/a", "/b"],
            ),
            (
                {
                    "DDALAB_MINIO_HOST": "m",
                    "DDALAB_MINIO_ACCESS_KEY": "a",
                    "DDALAB_MINIO_SECRET_KEY": "s",
                    "DDALAB_ALLOWED_DIRS": "",
                },
                "data",
                [],
            ),  # Default data_dir
        ],
    )
    def test_storage_settings(self, env_vars, expected_data_dir, expected_allowed_dirs):
        with patch.dict(os.environ, env_vars, clear=True):
            settings = StorageSettings()
            assert settings.data_dir == expected_data_dir
            assert settings.allowed_dirs == expected_allowed_dirs
            assert settings.minio_bucket_name == "dda-results"  # Default

    def test_storage_settings_allowed_dirs_parsing(self):
        with patch.dict(os.environ, {}, clear=True):
            # Need to provide required env vars to avoid ValidationError during init
            with patch.dict(
                os.environ,
                {
                    "DDALAB_MINIO_HOST": "m",
                    "DDALAB_MINIO_ACCESS_KEY": "a",
                    "DDALAB_MINIO_SECRET_KEY": "s",
                    "DDALAB_ALLOWED_DIRS": "/path/to/data, /another/path",
                },
            ):
                settings = StorageSettings()
                assert settings.allowed_dirs == ["/path/to/data", "/another/path"]

    @pytest.mark.parametrize(
        "env_vars,expected_host",
        [
            ({"DDALAB_OTLP_HOST": "collector"}, "collector"),
            ({}, "jaeger"),  # Default
        ],
    )
    def test_observability_settings(self, env_vars, expected_host):
        with patch.dict(os.environ, env_vars, clear=True):
            settings = ObservabilitySettings()
            assert settings.otlp_host == expected_host
            assert settings.otlp_port == 4318  # Default

    @pytest.mark.parametrize(
        "env_vars,expected_binary_path",
        [
            ({"DDALAB_DDA_BINARY_PATH": "/usr/bin/dda"}, "/usr/bin/dda"),
        ],
    )
    def test_dda_settings(self, env_vars, expected_binary_path):
        with patch.dict(os.environ, env_vars, clear=True):
            settings = DDASettings()
            assert settings.dda_binary_path == expected_binary_path

    def test_dda_settings_missing_required(self):
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(ValidationError):
                DDASettings()


class TestConfigurationService:
    """Test the ConfigurationService that aggregates settings."""

    @pytest.fixture(autouse=True)
    def setup_env(self):
        # Set up a minimal set of environment variables for tests that need a full config service
        with patch.dict(
            os.environ,
            {
                "DDALAB_RELOAD": "false",
                "DDALAB_API_HOST": "testhost",
                "DDALAB_API_PORT": "1234",
                "DDALAB_INSTITUTION_NAME": "TestOrg",
                "DDALAB_DATA_DIR": "/test_data",
                "DDALAB_DDA_BINARY_PATH": "/test_bin/dda",
                "DDALAB_DB_HOST": "testdb",
                "DDALAB_DB_PORT": "5432",
                "DDALAB_DB_NAME": "test_db",
                "DDALAB_DB_USER": "test_user",
                "DDALAB_DB_PASSWORD": "test_pass",
                "DDALAB_JWT_SECRET_KEY": "test_jwt_secret",
                "DDALAB_JWT_ALGORITHM": "HS256",
                "DDALAB_TOKEN_EXPIRATION_MINUTES": "120",
                "DDALAB_ALLOWED_DIRS": "/allowed1,/allowed2",
                "DDALAB_MINIO_HOST": "testminio",
                "DDALAB_MINIO_ACCESS_KEY": "minio_access",
                "DDALAB_MINIO_SECRET_KEY": "minio_secret",
                "DDALAB_MINIO_BUCKET_NAME": "test_bucket",
                "DDALAB_REDIS_HOST": "testredis",
                "DDALAB_REDIS_PORT": "6379",
                "DDALAB_OTLP_HOST": "testjaeger",
                "DDALAB_OTLP_PORT": "4317",
            },
            clear=True,
        ):
            yield
            # Clear cache after test
            get_config_service().reload_settings()

    def test_get_config_service_caching(self):
        # Ensure environment variables are set up (handled by fixture)
        # Clear cache before this specific test
        get_config_service().reload_settings()

        # Use mock to count provider instantiations
        with patch("core.environment.EnvironmentConfigProvider") as mock_provider_class:
            # Call twice
            service1 = get_config_service()
            service2 = get_config_service()

            # Should only instantiate EnvironmentConfigProvider once due to caching in get_config_service
            assert mock_provider_class.call_count == 1
            assert service1 is service2

    def test_config_service_gets_correct_settings(self):
        config = get_config_service()

        api_settings = config.get_api_settings()
        assert api_settings.api_host == "testhost"
        assert api_settings.api_port == 1234

        db_settings = config.get_database_settings()
        assert db_settings.db_host == "testdb"
        assert db_settings.db_user == "test_user"

        auth_settings = config.get_auth_settings()
        assert auth_settings.jwt_secret_key == "test_jwt_secret"
        assert auth_settings.auth_mode == "multi-user"  # Default if not set in fixture
        assert auth_settings.token_expiration_minutes == 120

        storage_settings = config.get_storage_settings()
        assert storage_settings.data_dir == "/test_data"
        assert storage_settings.minio_bucket_name == "test_bucket"
        assert storage_settings.allowed_dirs == ["/allowed1", "/allowed2"]

        cache_settings = config.get_cache_settings()
        assert cache_settings.redis_host == "testredis"

        dda_settings = config.get_dda_settings()
        assert dda_settings.dda_binary_path == "/test_bin/dda"

        observability_settings = config.get_observability_settings()
        assert observability_settings.otlp_host == "testjaeger"
        assert observability_settings.otlp_port == 4317

    def test_environment_config_provider_validation(self):
        # Test that missing required env vars raises ValueError
        with patch.dict(os.environ, {}, clear=True):  # Clear all env vars
            with pytest.raises(
                ValueError, match="Missing required environment variables"
            ):
                EnvironmentConfigProvider()
