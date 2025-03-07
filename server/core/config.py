"""Core configuration settings for the server."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional, Type, TypeVar

from pydantic import BaseModel
from pydantic_settings import BaseSettings


class ServerSettings(BaseSettings):
    """Server settings loaded from environment variables."""

    # API settings
    host: str = "localhost"
    port: int = 8001

    class Config:
        env_prefix = "DDALAB_"
        env_file = ".env"
        extra = "allow"


class DataSettings(BaseSettings):
    """Data directory settings."""

    data_dir: str = str(Path("data").absolute())

    class Config:
        env_prefix = "DDALAB_"
        env_file = ".env"
        extra = "allow"


class CelerySettings(BaseSettings):
    """Celery worker settings."""

    broker_url: str = "redis://localhost:6379/0"
    result_backend: str = "redis://localhost:6379/0"
    max_concurrent_tasks: int = 5
    task_timeout: int = 300  # seconds

    class Config:
        env_prefix = "DDALAB_CELERY_"
        env_file = ".env"
        extra = "allow"


class RedisSettings(BaseSettings):
    """Redis settings for task storage."""

    host: str = "localhost"
    port: int = 6379
    db: int = 0

    class Config:
        env_prefix = "DDALAB_REDIS_"
        env_file = ".env"
        extra = "allow"


T = TypeVar("T", bound=BaseModel)


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
        server_settings = self.load_config(ServerSettings, "server")
        if server_settings is None:
            server_settings = ServerSettings()
            self.save_config(server_settings, "server")
        configs["server"] = server_settings

        # Initialize data settings
        data_settings = self.load_config(DataSettings, "data")
        if data_settings is None:
            data_settings = DataSettings()
            self.save_config(data_settings, "data")
        configs["data"] = data_settings

        # Initialize celery settings
        celery_settings = self.load_config(CelerySettings, "celery")
        if celery_settings is None:
            celery_settings = CelerySettings()
            self.save_config(celery_settings, "celery")
        configs["celery"] = celery_settings

        # Initialize redis settings
        redis_settings = self.load_config(RedisSettings, "redis")
        if redis_settings is None:
            redis_settings = RedisSettings()
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
def get_server_settings() -> ServerSettings:
    """Get cached server settings instance."""
    # Try to load from disk first
    settings = config_manager.load_config(ServerSettings, "server")
    if settings is None:
        # Fall back to environment variables
        settings = ServerSettings()
        # Save for future use
        config_manager.save_config(settings, "server")
    return settings


@lru_cache
def get_data_settings() -> DataSettings:
    """Get cached data settings instance."""
    settings = config_manager.load_config(DataSettings, "data")
    if settings is None:
        settings = DataSettings()
        config_manager.save_config(settings, "data")
    return settings


@lru_cache
def get_celery_settings() -> CelerySettings:
    """Get cached celery settings instance."""
    settings = config_manager.load_config(CelerySettings, "celery")
    if settings is None:
        settings = CelerySettings()
        config_manager.save_config(settings, "celery")
    return settings


@lru_cache
def get_redis_settings() -> RedisSettings:
    """Get cached redis settings instance."""
    settings = config_manager.load_config(RedisSettings, "redis")
    if settings is None:
        settings = RedisSettings()
        config_manager.save_config(settings, "redis")
    return settings


def update_settings(setting_type: str, updates: Dict[str, Any]) -> BaseModel:
    """Update settings of a specific type.

    Args:
        setting_type: Type of settings to update ("server", "data", "celery", or "redis")
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
    elif setting_type == "celery":
        get_celery_settings.cache_clear()
        current = get_celery_settings()
    elif setting_type == "redis":
        get_redis_settings.cache_clear()
        current = get_redis_settings()
    else:
        raise ValueError(f"Invalid setting type: {setting_type}")

    return config_manager.update_config(current, setting_type, updates)
