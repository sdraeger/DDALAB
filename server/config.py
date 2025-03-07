"""Server configuration settings."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Server settings loaded from environment variables."""

    # API settings
    host: str = "localhost"
    port: int = 8000

    # Data directory settings
    data_dir: str = str(Path("data").absolute())

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

    class Config:
        env_prefix = "DDALAB_"
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance.

    Returns:
        Settings instance
    """
    return Settings()
