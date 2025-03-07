"""Celery application configuration."""

from celery import Celery

from .config import get_settings

settings = get_settings()

celery_app = Celery(
    "server",
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
    worker_max_tasks_per_child=settings.max_concurrent_tasks,
)

# Auto-discover tasks in the tasks directory
celery_app.autodiscover_tasks(["server.tasks"], force=True)

# Configure task routing
celery_app.conf.task_routes = {
    "server.tasks.dda.*": {"queue": "dda"},
}
