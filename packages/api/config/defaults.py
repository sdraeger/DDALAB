"""
Default configuration baked into the DDALAB container.
These defaults allow the container to run without any external configuration.
All values can be overridden by environment variables.
"""

import os
from typing import Dict, Any

# Default configuration values baked into the container
DEFAULT_CONFIG = {
    # Service Settings
    "ENVIRONMENT": "production",
    "DEBUG": "false",
    "SERVICE_NAME": "ddalab",
    "INSTITUTION_NAME": "DDALAB",
    
    # API Settings
    "API_HOST": "0.0.0.0",
    "API_PORT": "8001",
    "RELOAD": "false",
    
    # Database Settings (use defaults that work with stack)
    "DB_HOST": "postgres",
    "DB_PORT": "5432",
    "DB_NAME": "ddalab_db",
    "DB_USER": "ddalab",
    "DB_PASSWORD": "ddalab_default_password",
    
    # Redis Settings
    "REDIS_HOST": "redis",
    "REDIS_PORT": "6379",
    
    # MinIO Settings
    "MINIO_HOST": "minio:9000",
    "MINIO_ACCESS_KEY": "ddalab",
    "MINIO_SECRET_KEY": "ddalab_default_key",
    "MINIO_BUCKET_NAME": "dda-results",
    
    # Security Settings
    "JWT_SECRET_KEY": "default_jwt_secret_change_in_production",
    "NEXTAUTH_SECRET": "default_nextauth_secret_change_in_production",
    
    # Authentication
    "AUTH_MODE": "local",
    
    # Storage Settings
    "DATA_DIR": "/data",
    "ALLOWED_DIRS": "/data",
    "DDA_BINARY_PATH": "/app/bin/run_DDA_ASCII",
    
    # Frontend URLs
    "NEXT_PUBLIC_API_URL": "http://localhost:8001",
    "NEXT_PUBLIC_APP_URL": "http://localhost:3000",
    "NEXTAUTH_URL": "http://localhost:3000",
    
    # Observability
    "OTLP_ENDPOINT": "",
    "METRICS_ENABLED": "true",
    "LOG_LEVEL": "INFO",
}


def get_config_value(key: str, default: str = "") -> str:
    """
    Get configuration value with the following precedence:
    1. Environment variable
    2. Baked-in default
    3. Provided default
    """
    return os.getenv(key, DEFAULT_CONFIG.get(key, default))


def load_default_config() -> None:
    """
    Load default configuration into environment if not already set.
    This ensures the container works out-of-the-box.
    """
    for key, value in DEFAULT_CONFIG.items():
        if key not in os.environ:
            os.environ[key] = value


def get_all_config() -> Dict[str, Any]:
    """Get all current configuration values."""
    config = {}
    for key in DEFAULT_CONFIG.keys():
        config[key] = get_config_value(key)
    return config