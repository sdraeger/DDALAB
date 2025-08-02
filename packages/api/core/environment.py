"""
Environment-based Configuration System

This module implements a robust, SOLID-principles-based configuration system
that loads settings exclusively from environment variables, eliminating
config file persistence and state divergence issues.

SOLID Principles Applied:
- Single Responsibility: Each class has one clear purpose
- Open/Closed: Extensible via interfaces, closed for modification  
- Liskov Substitution: Implementations are substitutable
- Interface Segregation: Focused, minimal interfaces
- Dependency Inversion: Depends on abstractions, not concretions
"""

import os
from abc import ABC, abstractmethod
from enum import Enum
from typing import Dict, List, Optional, Union
from loguru import logger
from pydantic import field_validator
from pydantic_settings import BaseSettings


class Environment(Enum):
    """Application environment types."""
    DEVELOPMENT = "development"
    PRODUCTION = "production" 
    TESTING = "testing"


class ServiceSettings(BaseSettings):
    """Base settings with common configuration."""
    
    # Environment Detection
    environment: Environment = Environment.DEVELOPMENT
    debug: bool = False
    
    # Service Identity
    service_name: str = "ddalab"
    institution_name: str = "DDALAB"
    
    class Config:
        env_prefix = "DDALAB_"
        case_sensitive = False
        extra = "ignore"  # Ignore unknown environment variables


class DatabaseSettings(BaseSettings):
    """Database configuration settings."""
    
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "ddalab"
    db_user: str
    db_password: str
    
    @property
    def connection_url(self) -> str:
        """Get database connection URL."""
        return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"
    
    class Config:
        env_prefix = "DDALAB_"


class AuthSettings(BaseSettings):
    """Authentication and security settings."""
    
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    auth_mode: str = "multi-user"
    token_expiration_minutes: int = 10080  # 7 days
    refresh_token_expire_days: int = 7
    
    class Config:
        env_prefix = "DDALAB_"


class StorageSettings(BaseSettings):
    """Storage configuration (MinIO, file system)."""
    
    # MinIO Configuration
    minio_host: str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket_name: str = "dda-results"
    
    # File System
    data_dir: str = "data"
    allowed_dirs: Union[List[str], str]
    
    @field_validator("allowed_dirs", mode="before")
    @classmethod
    def parse_allowed_dirs(cls, v):
        """Parse allowed directories from string or list."""
        if isinstance(v, str):
            # Handle comma-separated values or single directory
            return [d.strip() for d in v.split(",") if d.strip()]
        return v
    
    class Config:
        env_prefix = "DDALAB_"


class CacheSettings(BaseSettings):
    """Caching configuration (Redis)."""
    
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    redis_password: Optional[str] = None
    redis_use_ssl: bool = False
    plot_cache_ttl: int = 3600
    
    class Config:
        env_prefix = "DDALAB_"


class APISettings(BaseSettings):
    """API server configuration."""
    
    api_host: str = "0.0.0.0"
    api_port: int = 8001
    reload: bool = False
    
    class Config:
        env_prefix = "DDALAB_"


class DDASettings(BaseSettings):
    """DDA-specific configuration."""
    
    dda_binary_path: str
    anonymize_edf: bool = False
    max_concurrent_tasks: int = 5
    task_timeout: int = 300
    
    class Config:
        env_prefix = "DDALAB_"


class ObservabilitySettings(BaseSettings):
    """Monitoring and observability settings."""
    
    otlp_host: str = "jaeger"
    otlp_port: int = 4318
    
    class Config:
        env_prefix = "DDALAB_"


# Configuration Provider Interface (SOLID: Interface Segregation)
class ConfigProvider(ABC):
    """Abstract configuration provider interface."""
    
    @abstractmethod
    def get_service_settings(self) -> ServiceSettings:
        """Get service settings."""
        pass
    
    @abstractmethod
    def get_database_settings(self) -> DatabaseSettings:
        """Get database settings."""
        pass
    
    @abstractmethod
    def get_auth_settings(self) -> AuthSettings:
        """Get authentication settings."""
        pass
    
    @abstractmethod
    def get_storage_settings(self) -> StorageSettings:
        """Get storage settings."""
        pass
    
    @abstractmethod
    def get_cache_settings(self) -> CacheSettings:
        """Get cache settings."""
        pass
    
    @abstractmethod
    def get_api_settings(self) -> APISettings:
        """Get API settings."""
        pass
    
    @abstractmethod
    def get_dda_settings(self) -> DDASettings:
        """Get DDA settings."""
        pass
    
    @abstractmethod
    def get_observability_settings(self) -> ObservabilitySettings:
        """Get observability settings."""
        pass


class EnvironmentConfigProvider(ConfigProvider):
    """Configuration provider that loads from environment variables only.
    
    SOLID Principles:
    - Single Responsibility: Load configuration from environment
    - Dependency Inversion: Implements ConfigProvider abstraction
    """
    
    def __init__(self):
        self._validate_required_env_vars()
    
    def _validate_required_env_vars(self) -> None:
        """Validate that required environment variables are set."""
        required_vars = [
            "DDALAB_DB_USER",
            "DDALAB_DB_PASSWORD", 
            "DDALAB_JWT_SECRET_KEY",
            "DDALAB_MINIO_HOST",
            "DDALAB_MINIO_ACCESS_KEY",
            "DDALAB_MINIO_SECRET_KEY",
            "DDALAB_DDA_BINARY_PATH",
            "DDALAB_ALLOWED_DIRS"
        ]
        
        missing_vars = [var for var in required_vars if not os.getenv(var)]
        if missing_vars:
            raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")
    
    def get_service_settings(self) -> ServiceSettings:
        return ServiceSettings()
    
    def get_database_settings(self) -> DatabaseSettings:
        return DatabaseSettings()
    
    def get_auth_settings(self) -> AuthSettings:
        return AuthSettings()
    
    def get_storage_settings(self) -> StorageSettings:
        return StorageSettings()
    
    def get_cache_settings(self) -> CacheSettings:
        return CacheSettings()
    
    def get_api_settings(self) -> APISettings:
        return APISettings()
    
    def get_dda_settings(self) -> DDASettings:
        return DDASettings()
    
    def get_observability_settings(self) -> ObservabilitySettings:
        return ObservabilitySettings()


class ConfigurationService:
    """Main configuration service that aggregates all settings.
    
    SOLID Principles:
    - Single Responsibility: Coordinate configuration access
    - Dependency Inversion: Depends on ConfigProvider abstraction
    - Open/Closed: Open for extension via different providers
    """
    
    def __init__(self, provider: ConfigProvider):
        self._provider = provider
        self._cache: Dict[str, BaseSettings] = {}
        logger.info("Configuration service initialized")
    
    def get_service_settings(self) -> ServiceSettings:
        """Get service settings with caching."""
        if "service" not in self._cache:
            self._cache["service"] = self._provider.get_service_settings()
        return self._cache["service"]
    
    def get_database_settings(self) -> DatabaseSettings:
        """Get database settings with caching."""
        if "database" not in self._cache:
            self._cache["database"] = self._provider.get_database_settings()
        return self._cache["database"]
    
    def get_auth_settings(self) -> AuthSettings:
        """Get auth settings with caching."""
        if "auth" not in self._cache:
            self._cache["auth"] = self._provider.get_auth_settings()
        return self._cache["auth"]
    
    def get_storage_settings(self) -> StorageSettings:
        """Get storage settings with caching."""
        if "storage" not in self._cache:
            self._cache["storage"] = self._provider.get_storage_settings()
        return self._cache["storage"]
    
    def get_cache_settings(self) -> CacheSettings:
        """Get cache settings with caching."""
        if "cache" not in self._cache:
            self._cache["cache"] = self._provider.get_cache_settings()
        return self._cache["cache"]
    
    def get_api_settings(self) -> APISettings:
        """Get API settings with caching."""
        if "api" not in self._cache:
            self._cache["api"] = self._provider.get_api_settings()
        return self._cache["api"]
    
    def get_dda_settings(self) -> DDASettings:
        """Get DDA settings with caching."""
        if "dda" not in self._cache:
            self._cache["dda"] = self._provider.get_dda_settings()
        return self._cache["dda"]
    
    def get_observability_settings(self) -> ObservabilitySettings:
        """Get observability settings with caching."""
        if "observability" not in self._cache:
            self._cache["observability"] = self._provider.get_observability_settings()
        return self._cache["observability"]
    
    def reload_settings(self) -> None:
        """Clear cache and force reload of all settings."""
        self._cache.clear()
        logger.info("Configuration cache cleared, settings will be reloaded on next access")
    
    def get_environment(self) -> Environment:
        """Get current environment."""
        return self.get_service_settings().environment
    
    def is_development(self) -> bool:
        """Check if running in development mode."""
        return self.get_environment() == Environment.DEVELOPMENT
    
    def is_production(self) -> bool:
        """Check if running in production mode."""
        return self.get_environment() == Environment.PRODUCTION


# Global configuration service instance
_config_service: Optional[ConfigurationService] = None


def get_config_service() -> ConfigurationService:
    """Get the global configuration service instance."""
    global _config_service
    if _config_service is None:
        provider = EnvironmentConfigProvider()
        _config_service = ConfigurationService(provider)
    return _config_service


def initialize_config(provider: Optional[ConfigProvider] = None) -> ConfigurationService:
    """Initialize the global configuration service with a specific provider."""
    global _config_service
    if provider is None:
        provider = EnvironmentConfigProvider()
    _config_service = ConfigurationService(provider)
    return _config_service


# Convenience functions for backward compatibility
def get_database_settings() -> DatabaseSettings:
    """Get database settings."""
    return get_config_service().get_database_settings()


def get_storage_settings() -> StorageSettings:
    """Get storage settings."""
    return get_config_service().get_storage_settings()


def get_auth_settings() -> AuthSettings:
    """Get auth settings."""
    return get_config_service().get_auth_settings()