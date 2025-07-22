import os
from pathlib import Path
from typing import Optional, Tuple

import dda_py
from loguru import logger


def validate_dda_binary(settings) -> Tuple[bool, Optional[str]]:
    """Validate that the DDA binary exists and is executable.

    Returns:
        Tuple of (is_valid, error_message)
    """
    try:
        binary_path = Path(settings.dda_binary_path)

        # Check if file exists
        if not binary_path.exists():
            return False, f"DDA binary not found at path: {settings.dda_binary_path}"

        # Check if file is executable
        if not os.access(binary_path, os.X_OK):
            return False, f"DDA binary is not executable: {settings.dda_binary_path}"

        # Try to initialize dda_py
        dda_py.init(settings.dda_binary_path)
        logger.info(f"DDA binary validated successfully: {settings.dda_binary_path}")
        return True, None

    except Exception as e:
        error_msg = f"DDA binary initialization failed: {str(e)}"
        logger.error(f"DDA binary validation failed: {error_msg}")
        return False, error_msg
