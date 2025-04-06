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


# @celery_app.task(
#     name="server.tasks.dda.run_dda", bind=True, ignore_result=False, track_started=True
# )
def run_dda(
    # self=None,
    file_path: Path = None,
    channel_list: list[int] = None,
    preprocessing_options: dict[str, bool | int | float | str] = None,
) -> DDAResult:
    """Run DDA on a file.

    Args:
        self: Celery task instance, can be None when called directly
        file_path: Path to the file
        channel_list: List of channels to analyze
        preprocessing_options: Preprocessing options

    Returns:
        DDAResult object
    """
    # Initialize variables
    task_id = "direct_call"

    logger.info(f"Starting DDA directly (not as Celery task) for file: {file_path}")

    logger.info(f"[{task_id}] Preprocessing options: {preprocessing_options}")
    logger.info(f"[{task_id}] file_path: {file_path}")

    try:
        Q, ST_filepath = dda_py.run_dda(
            input_file=file_path,
            output_file=None,
            channel_list=channel_list,
            bounds=None,
            cpu_time=False,
        )

        logger.info(f"{Q.shape = }")
        logger.info(f"[{task_id}] DDA calculation completed successfully")

        Q = np.where(np.isnan(Q), None, Q).tolist()

        result = DDAResult(
            file_path=file_path,
            Q=Q,
            preprocessing_options=preprocessing_options,
        ).model_dump()

        logger.info(f"[{task_id}] Returning DDA result")
        return result
    except Exception as e:
        error_msg = f"Error during DDA execution: {e}"
        logger.error(f"[{task_id}] {error_msg}")

        # Update failure state if called as a Celery task
        # if self is not None:
        # self.update_state(state="FAILURE", meta={"error": str(e)})

        raise


@celery_app.task(name="server.tasks.dda.cleanup_task")
def cleanup_task(task_id: str) -> None:
    """Clean up resources after a task completes.

    Args:
        task_id: Task ID to clean up
    """
    # TODO: Implement cleanup
    pass
