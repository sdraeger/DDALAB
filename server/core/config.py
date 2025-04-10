"""Core configuration settings for the server."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional, Type, TypeVar, Union

from loguru import logger
from pydantic import BaseModel, field_validator
from pydantic_settings import BaseSettings

T = TypeVar("T", bound=BaseModel)


class Settings(BaseSettings):
    """Server settings loaded from environment variables."""

    # Development settings
    reload: bool

    # API settings
    api_host: str
    api_port: int

    # Data directory settings
    data_dir: str
    anonymize_edf: bool = False  # Whether to anonymize EDF files by default

    # DDA binary settings
    dda_binary_path: str

    # Analysis settings
    max_concurrent_tasks: int
    task_timeout: int

    # Redis settings (for task result storage)
    redis_host: str
    redis_port: int
    redis_db: int

    # PostgreSQL Database settings
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str

    # SSL settings
    ssl_enabled: bool
    ssl_cert_path: str | None = None
    ssl_key_path: str | None = None

    # Authentication settings
    jwt_secret_key: str
    jwt_algorithm: str
    auth_enabled: bool
    token_expiration_minutes: int

    # Allowed directories
    allowed_dirs: Union[list[str], str]

    # Minio settings
    minio_host: str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket_name: str

    @field_validator("allowed_dirs", mode="before")
    @classmethod
    def parse_allowed_dirs(cls, value):
        """Parse the allowed_dirs setting.

        Args:
            value: Value to parse

        Returns:
            Parsed value
        """

        if isinstance(value, str):
            try:
                # Parse the comma-separated string with colon-separated parts
                return {pair.split(":")[1] for pair in value.split(",")}
            except (IndexError, ValueError) as e:
                logger.error(f"Failed to parse allowed_dirs: {e}")
                raise ValueError(f"Invalid ALLOWED_DIRS format: {value}")
        elif value is None:
            return []  # Default to empty list if not provided

        return value  # Return as-is if already a list

    class Config:
        env_prefix = "DDALAB_"
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "allow"


class ConfigManager:
    """Configuration manager for saving and loading settings."""

    def __init__(self, config_dir: str = ".config"):
        """Initialize the configuration manager.

        Args:
            config_dir: Directory to store configuration files
        """
        self.config_dir = Path(config_dir)
        self.config_dir.mkdir(parents=True, exist_ok=True)

    def _get_config_path(self, config_name: str) -> Path:
        """Get the path to a configuration file.

        Args:
            config_name: Name of the configuration

        Returns:
            Path to the configuration file
        """
        return self.config_dir / f"{config_name}.json"

    def save_config(self, config: BaseModel, config_name: str) -> None:
        """Save a configuration to disk.

        Args:
            config: Configuration object to save
            config_name: Name of the configuration
        """
        config_path = self._get_config_path(config_name)
        with open(config_path, "w") as f:
            json.dump(config.model_dump(), f, indent=2)

    def load_config(self, config_class: Type[T], config_name: str) -> Optional[T]:
        """Load a configuration from disk.

        Args:
            config_class: Class of the configuration to load
            config_name: Name of the configuration

        Returns:
            Loaded configuration object or None if not found
        """
        config_path = self._get_config_path(config_name)
        if not config_path.exists():
            return None

        with open(config_path) as f:
            data = json.load(f)

            # Handle case where keys may have env prefix
            if config_class == Settings:
                prefix = "ddalab_"
                # Create a new dict with prefixes removed
                processed_data = {}
                for key, value in data.items():
                    if key.lower().startswith(prefix):
                        # Strip the prefix
                        clean_key = key[len(prefix) :]
                        processed_data[clean_key] = value
                    else:
                        processed_data[key] = value
                return config_class(**processed_data)

            return config_class(**data)

    def update_config(
        self, config: BaseModel, config_name: str, updates: Dict[str, Any]
    ) -> BaseModel:
        """Update a configuration with new values.

        Args:
            config: Current configuration object
            config_name: Name of the configuration
            updates: Dictionary of updates to apply

        Returns:
            Updated configuration object
        """
        # Create a new config with updates
        updated_data = {**config.model_dump(), **updates}
        updated_config = config.__class__(**updated_data)

        # Save the updated config
        self.save_config(updated_config, config_name)
        return updated_config

    def initialize_all(self) -> Dict[str, BaseModel]:
        """Initialize all configurations, loading from disk or creating defaults.

        Returns:
            Dictionary mapping configuration names to their loaded instances
        """
        configs = {}

        # Initialize server settings
        server_settings = self.load_config(Settings, "server")
        if server_settings is None:
            server_settings = Settings()
            self.save_config(server_settings, "server")
        configs["server"] = server_settings

        # Initialize data settings
        data_settings = self.load_config(Settings, "data")
        if data_settings is None:
            data_settings = Settings()
            self.save_config(data_settings, "data")
        configs["data"] = data_settings

        # Initialize redis settings
        redis_settings = self.load_config(Settings, "redis")
        if redis_settings is None:
            redis_settings = Settings()
            self.save_config(redis_settings, "redis")
        configs["redis"] = redis_settings

        return configs


# Global config manager instance
config_manager = ConfigManager()


def initialize_config() -> Dict[str, BaseModel]:
    """Initialize all configurations and ensure they are saved to disk.

    Returns:
        Dictionary containing all initialized configurations
    """
    return config_manager.initialize_all()


@lru_cache
def get_server_settings() -> Settings:
    """Get cached server settings instance.

    Returns:
        Settings instance configured for server operations
    """
    return config_manager.load_config(Settings, "server") or Settings()


@lru_cache
def get_data_settings() -> Settings:
    """Get cached data settings instance.

    Returns:
        Settings instance configured for data operations
    """
    return config_manager.load_config(Settings, "data") or Settings()


def update_settings(setting_type: str, updates: Dict[str, Any]) -> BaseModel:
    """Update settings of a specific type.

    Args:
        setting_type: Type of settings to update ("server", "data", or "redis")
        updates: Dictionary of updates to apply

    Returns:
        Updated settings object

    Raises:
        ValueError: If setting_type is invalid
    """
    # Clear the cache for the updated settings
    if setting_type == "server":
        get_server_settings.cache_clear()
        current = get_server_settings()
    elif setting_type == "data":
        get_data_settings.cache_clear()
        current = get_data_settings()
    elif setting_type == "redis":
        get_server_settings.cache_clear()
        current = get_server_settings()
    else:
        raise ValueError(f"Invalid setting type: {setting_type}")

    return config_manager.update_config(current, setting_type, updates)
