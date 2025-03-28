"""Celery application configuration."""

from celery import Celery

from .core.config import get_server_settings

settings = get_server_settings()

celery_app = Celery(
    "server",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["server.tasks.dda"],  # Explicitly include the tasks module
)

# Configure Celery
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=settings.task_timeout,
    worker_max_tasks_per_child=settings.max_concurrent_tasks,
    broker_connection_retry_on_startup=True,  # Add this to handle the deprecation warning
)

# Configure task routing
celery_app.conf.task_routes = {
    "server.tasks.dda.*": {"queue": "dda"},
}

# This ensures the app is properly initialized
celery_app.autodiscover_tasks()

# Make the Celery app available at the module level
__all__ = ("celery_app",)
