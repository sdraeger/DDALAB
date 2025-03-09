"""Server configuration settings."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Server settings loaded from environment variables."""

    # API settings
    host: str = "localhost"
    port: int = 8001

    # Data directory settings
    data_dir: str = str(Path("data").absolute())

    # DDA binary settings
    dda_binary_path: str = "/usr/local/bin/dda"  # Default path to DDA binary

    # Analysis settings
    max_concurrent_tasks: int = 5
    task_timeout: int = 300  # seconds

    # Celery settings
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/0"

    # Redis settings (for task result storage)
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0

    # SSL settings
    ssl_enabled: bool = False
    ssl_cert_path: str = "ssl/cert.pem"
    ssl_key_path: str = "ssl/key.pem"

    # Email settings
    admin_email: str = "admin@example.com"
    smtp_server: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""

    class Config:
        env_prefix = "DDALAB_"
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance.

    Returns:
        Settings instance
    """
    return Settings()
