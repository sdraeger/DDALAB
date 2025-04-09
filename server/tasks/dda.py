"""DDA task definitions."""

from pathlib import Path

import dda_py
import numpy as np
from loguru import logger

from ..core.config import get_server_settings
from ..schemas.dda import DDAResult

__all__ = ["run_dda"]

settings = get_server_settings()
dda_py.init(settings.dda_binary_path)


def run_dda(
    file_path: Path = None,
    channel_list: list[int] = None,
    preprocessing_options: dict[str, bool | int | float | str] = None,
) -> DDAResult:
    """Run DDA on a file.

    Args:
        file_path: Path to the file
        channel_list: List of channels to analyze
        preprocessing_options: Preprocessing options

    Returns:
        DDAResult object
    """
    # Initialize variables
    logger.info(f"Running DDA on file: {file_path}")
    logger.info(f"Preprocessing options: {preprocessing_options}")

    try:
        Q, ST_filepath = dda_py.run_dda(
            input_file=file_path,
            output_file=None,
            channel_list=channel_list,
            bounds=None,
            cpu_time=False,
        )

        logger.info("DDA computation completed successfully")

        Q = np.where(np.isnan(Q), None, Q).tolist()

        result = DDAResult(
            file_path=file_path,
            Q=Q,
            preprocessing_options=preprocessing_options,
        ).model_dump()

        logger.info("Returning DDA result")
        return result
    except Exception as e:
        error_msg = f"Error during DDA computation: {e}"
        logger.error(error_msg)
        raise
