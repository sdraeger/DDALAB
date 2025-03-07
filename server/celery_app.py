"""Celery application configuration."""

from celery import Celery

from server.core.config import get_celery_settings

settings = get_celery_settings()

# Create Celery app
celery_app = Celery(
    "ddalab",
    broker=settings.broker_url,
    backend=settings.result_backend,
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
)

# Auto-discover tasks in the tasks directory
celery_app.autodiscover_tasks(["server.tasks"], force=True)

# Optional: Configure task routes for different queues
celery_app.conf.task_routes = {
    "server.tasks.analysis.*": {"queue": "analysis"},
}
