"""DDA task definitions."""

from pathlib import Path

import dda_py
import numpy as np
from loguru import logger

from ..celery_app import celery_app
from ..core.config import get_server_settings
from ..schemas.dda import DDAResult

__all__ = ["run_dda", "cleanup_task"]

settings = get_server_settings()
dda_py.init(settings.dda_binary_path)


@celery_app.task(
    name="server.tasks.dda.run_dda", bind=True, ignore_result=False, track_started=True
)
def run_dda(
    self,
    file_path: Path,
    channel_list: list[int],
    preprocessing_options: dict[str, bool | int | float | str],
) -> DDAResult:
    """Run DDA on a file.

    Args:
        self: Celery task instance

    Returns:
        DDAResult object
    """

    self.update_state(state="STARTED", meta={"file_path": file_path})

    logger.info(f"[Task {self.request.id}] Starting DDA for file: {file_path}")
    logger.info(
        f"[Task {self.request.id}] Preprocessing options: {preprocessing_options}"
    )
    logger.info(f"[Task {self.request.id}] file_path: {file_path}")

    try:
        Q, ST_filepath = dda_py.run_dda(
            input_file=file_path,
            output_file=None,
            channel_list=channel_list,
            bounds=None,
            cpu_time=False,
        )

        logger.info(f"{Q.shape = }")
        logger.info(f"[Task {self.request.id}] Task completed successfully")

        Q = np.where(np.isnan(Q), None, Q).tolist()

        return DDAResult(
            file_path=file_path,
            Q=Q,
            preprocessing_options=preprocessing_options,
        ).model_dump()
    except Exception as e:
        logger.error(f"[Task {self.request.id}] Error during task execution: {e}")
        self.update_state(state="FAILURE", meta={"error": str(e)})
        raise


@celery_app.task(name="server.tasks.dda.cleanup_task")
def cleanup_task(task_id: str) -> None:
    """Clean up resources after a task completes.

    Args:
        task_id: Task ID to clean up
    """
    # TODO: Implement cleanup
    pass
