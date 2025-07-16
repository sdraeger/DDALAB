import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional, Type, TypeVar, Union

from loguru import logger
from pydantic import BaseModel, computed_field, field_validator, model_validator
from pydantic_settings import BaseSettings

T = TypeVar("T", bound=BaseModel)


class Settings(BaseSettings):
    """Server settings loaded from environment variables."""

    # Development settings
    reload: bool
    debug: bool = False  # Default to False for security

    # API settings
    api_host: str
    api_port: int

    # Institution name
    institution_name: str

    # Data directory settings
    data_dir: str
    anonymize_edf: bool = False

    # DDA binary settings
    dda_binary_path: str

    # PostgreSQL Database settings
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str

    # Authentication settings
    jwt_secret_key: str
    jwt_algorithm: str
    auth_mode: str = "multi-user"
    token_expiration_minutes: int
    refresh_token_expire_days: int = 7  # Default to 7 days

    # Allowed directories
    allowed_dirs: Union[list[str], str]

    # Minio settings
    minio_host: str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket_name: str

    # OpenTelemetry settings
    otlp_host: str
    otlp_port: int = 4317

    @computed_field
    @property
    def database_url(self) -> str:
        """Get the database URL.

        Returns:
            Database URL in the format: postgresql+asyncpg://user:password@host:port/dbname
        """
        return f"postgresql+asyncpg://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"

    @computed_field
    @property
    def auth_enabled(self) -> bool:
        """Compute auth_enabled based on auth_mode and backward compatibility.

        Returns:
            True if authentication is enabled (multi-user mode), False otherwise
        """
        # If auth_enabled is explicitly set via environment variable (backward compatibility)
        auth_enabled_env = os.getenv("DDALAB_AUTH_ENABLED")
        if auth_enabled_env is not None:
            return auth_enabled_env.lower() in ("true", "1", "yes", "on")

        # Otherwise, use auth_mode
        return self.auth_mode == "multi-user"

    @computed_field
    @property
    def is_local_mode(self) -> bool:
        """Check if the application is running in local mode.

        Returns:
            True if in local mode (authentication disabled), False otherwise
        """
        # Use the computed auth_enabled property to determine local mode
        return not self.auth_enabled

    @field_validator("auth_mode")
    @classmethod
    def validate_auth_mode(cls, value: str) -> str:
        """Validate auth_mode values.

        Args:
            value: The auth_mode value to validate

        Returns:
            Validated auth_mode value

        Raises:
            ValueError: If auth_mode is not a valid value
        """
        valid_modes = ["multi-user", "local"]
        if value not in valid_modes:
            logger.warning(
                f"Invalid auth_mode '{value}', defaulting to 'multi-user' for security"
            )
            return "multi-user"
        return value

    @model_validator(mode="after")
    def handle_backward_compatibility(self) -> "Settings":
        """Handle backward compatibility with DDALAB_AUTH_ENABLED.

        Returns:
            Settings instance with properly configured auth_mode
        """
        # Check if DDALAB_AUTH_ENABLED is explicitly set via environment variable
        auth_enabled_env = os.getenv("DDALAB_AUTH_ENABLED")
        if auth_enabled_env is not None:
            auth_enabled_value = auth_enabled_env.lower() in ("true", "1", "yes", "on")

            if auth_enabled_value:
                # auth_enabled=True means multi-user mode
                if self.auth_mode != "multi-user":
                    logger.info(
                        "DDALAB_AUTH_ENABLED=True detected, setting auth_mode to 'multi-user'"
                    )
                    object.__setattr__(self, "auth_mode", "multi-user")
            else:
                # auth_enabled=False means local mode
                if self.auth_mode != "local":
                    logger.info(
                        "DDALAB_AUTH_ENABLED=False detected, setting auth_mode to 'local'"
                    )
                    object.__setattr__(self, "auth_mode", "local")

        return self

    @field_validator("allowed_dirs", mode="before")
    @classmethod
    def parse_allowed_dirs(cls, value):
        """Parse the allowed_dirs setting.

        Args:
            value: Value to parse

        Returns:
            Parsed value
        """
        logger.info(f"[Config] Parsing allowed_dirs from value: {value}")

        # Check reload from environment directly to avoid instantiating Settings
        reload_env = os.getenv("DDALAB_RELOAD", "False")
        reload_value = reload_env.lower() in ("true", "1", "yes", "on")

        if reload_value:
            # Development mode: use simple paths or Docker host paths
            if isinstance(value, str):
                if value.strip():
                    # Check if it's Docker format (host:container:access)
                    if ":" in value and len(value.split(":")) >= 3:
                        # Extract host paths from Docker format for development
                        host_paths = []
                        for pair in value.split(","):
                            parts = pair.strip().split(":")
                            if len(parts) >= 2:
                                host_paths.append(parts[0])  # Use host path
                        logger.info(
                            f"[Config] Development mode: extracted host paths from Docker format: {host_paths}"
                        )
                        return host_paths
                    else:
                        # Simple comma-separated paths
                        parsed_dirs = [path.strip() for path in value.split(",")]
                        logger.info(
                            f"[Config] Development mode: parsed allowed_dirs as list: {parsed_dirs}"
                        )
                        return parsed_dirs
                return []  # Return empty list for empty string
            elif isinstance(value, list):
                logger.info(
                    f"[Config] Development mode: using allowed_dirs as list: {value}"
                )
                return value
            elif value is None:
                return []
            else:
                raise ValueError(
                    f"Invalid ALLOWED_DIRS type in development mode: {type(value)}"
                )

        # Production mode: use container paths from Docker format
        if isinstance(value, str):
            if not value.strip():
                # Handle empty string case
                logger.info(
                    "[Config] Production mode: empty string, returning empty list"
                )
                return []

            try:
                # In production mode, parse <host>:<container>:<access> format
                # But also handle simple comma-separated paths as fallback
                if ":" in value and len(value.split(":")) >= 3:
                    # Production format: host1:/container1:rw,host2:/container2:ro
                    container_paths = []
                    for pair in value.split(","):
                        parts = pair.strip().split(":")
                        if len(parts) >= 2:
                            container_paths.append(parts[1])  # Use container path
                    logger.info(
                        f"[Config] Production mode: parsed container paths: {container_paths}"
                    )
                    return container_paths
                else:
                    # Fallback: simple comma-separated paths like /tmp,/data
                    parsed_dirs = [
                        path.strip() for path in value.split(",") if path.strip()
                    ]
                    logger.info(
                        f"[Config] Production mode: parsed simple paths: {parsed_dirs}"
                    )
                    return parsed_dirs
            except (IndexError, ValueError) as e:
                logger.error(f"Failed to parse allowed_dirs: {e}")
                raise ValueError(f"Invalid ALLOWED_DIRS format: {value}")
        elif value is None:
            return []  # Return empty list for None in production mode

        return value

    class Config:
        env_prefix = "DDALAB_"
        env_file = str(os.getenv("DDALAB_ENV_FILE", ".env"))
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

            if config_class == Settings:
                prefix = "ddalab_"
                processed_data = {}
                for key, value in data.items():
                    if key.lower().startswith(prefix):
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
        updated_data = {**config.model_dump(), **updates}
        updated_config = config.__class__(**updated_data)
        self.save_config(updated_config, config_name)
        return updated_config

    def initialize_all(self) -> Dict[str, BaseModel]:
        """Initialize all configurations, loading from disk or creating defaults.

        Returns:
            Dictionary mapping configuration names to their loaded instances
        """
        configs = {}

        server_settings = self.load_config(Settings, "server")
        if server_settings is None:
            server_settings = Settings()
            self.save_config(server_settings, "server")
        configs["server"] = server_settings

        data_settings = self.load_config(Settings, "data")
        if data_settings is None:
            data_settings = Settings()
            self.save_config(data_settings, "data")
        configs["data"] = data_settings

        return configs


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
        setting_type: Type of settings to update ("server" or "data")
        updates: Dictionary of updates to apply

        Returns:
            Updated settings object

        Rais:
            ValueError: If setting_type is invalid
    """
    if setting_type == "server":
        get_server_settings.cache_clear()
        current = get_server_settings()
    elif setting_type == "data":
        get_data_settings.cache_clear()
        current = get_data_settings()
    else:
        raise ValueError(f"Invalid setting type: {setting_type}")

    return config_manager.update_config(current, setting_type, updates)
