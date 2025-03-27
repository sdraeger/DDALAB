"""DDA task definitions."""

import os
import subprocess
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from loguru import logger

from ..celery_app import celery_app
from ..core.utils.utils import create_tempfile, make_dda_command
from ..schemas.dda import DDARequest, DDAResult

__all__ = ["run_dda", "cleanup_task"]

load_dotenv()

DDA_BINARY_PATH = os.getenv("DDA_BINARY_PATH")


@celery_app.task(
    name="server.tasks.dda.run_dda", bind=True, ignore_result=False, track_started=True
)
def run_dda(
    self,
    request: DDARequest,
) -> dict:
    """Run DDA on a file.

    Args:
        self: Celery task instance
        file_path: Path to the file to analyze
        preprocessing_options: Dictionary of preprocessing options

    Returns:
        Dictionary containing DDA results
    """

    self.update_state(state="STARTED", meta={"file_path": request.file_path})
    logger.info(
        f"[Task {self.request.id}] Starting DDA analysis for file: {request.file_path}"
    )
    logger.info(
        f"[Task {self.request.id}] Preprocessing options: {request.preprocessing_options}"
    )

    tempf = create_tempfile(subdir=f"task-{self.request.id}", suffix=".dda")
    command = make_dda_command(
        DDA_BINARY_PATH,
        request.file_path,
        tempf.name,
        request.channel_list,
        request.bounds,
        request.cpu_time,
    )

    logger.info(f"{command = }")

    try:
        p = subprocess.Popen(command, stdout=subprocess.PIPE)
        p.wait()
        output = p.stdout.read().decode("utf-8")
        logger.info(f"[Task {self.request.id}] DDA output: {output}")

        p.stdout.close()
        p.wait()

        logger.info(f"Return code: {p.returncode}")

        ST_filename = f"{tempf.name}_ST"
        file_path = Path(ST_filename)

        # Read all lines, skip the last one, and write back
        lines = file_path.read_text().splitlines()[:-1]
        file_path.write_text("\n".join(lines))

        Q = np.loadtxt(ST_filename)
        logger.info(f"{Q.shape = }")
        logger.info(f"[Task {self.request.id}] Task completed successfully")

        return DDAResult(
            file_path=request.file_path,
            Q=Q.tolist(),
            preprocessing_options=request.preprocessing_options,
        )
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
