"""Celery application configuration."""

from celery import Celery
from .config import get_settings

settings = get_settings()

# Create Celery app
celery_app = Celery(
    "ddalab",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
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
    worker_max_tasks_per_child=100,
)

# Optional: Configure task routes for different queues
celery_app.conf.task_routes = {
    "server.tasks.analysis.*": {"queue": "analysis"},
}
