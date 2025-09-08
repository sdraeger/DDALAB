"""Utility functions for the server."""

import hashlib
import os
import re
import tempfile
from pathlib import Path
from typing import List, Tuple, Optional

# Constants for fixed parameters
BASE_PARAMS = {
    "-dm": "4",
    "-order": "4",
    "-nr_tau": "2",
    "-WL": "125",
    "-WS": "62",
    "-SELECT": ["1", "0", "0", "0"],
    "-MODEL": ["1", "2", "10"],
    "-TAU": ["7", "10"],
}

__all__ = [
    "get_env_var",
    "calculate_file_hash",
    "calculate_str_hash",
    "camel_to_snake",
    "make_dda_command",
    "create_tempfile",
]


def calculate_file_hash(file_path: Path) -> str:
    """Calculate SHA-256 hash of a file.

    Args:
        file_path: Path to the file

    Returns:
        str: Hex digest of the file hash
    """
    sha256_hash = hashlib.sha256()

    with open(file_path, "rb") as f:
        # Read the file in chunks to handle large files efficiently
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)

    return sha256_hash.hexdigest()


def calculate_str_hash(string: str) -> str:
    """Get the hash of a string."""
    return hashlib.sha256(string.encode()).hexdigest()


def camel_to_snake(name):
    """Converts a camel case string to snake case."""
    name = re.sub("(.)([A-Z][a-z]+)", r"\1_\2", name)
    name = re.sub("([a-z0-9])([A-Z])", r"\1_\2", name).lower()
    return name


def create_tempfile(subdir: str, **kwargs):
    d = Path(tempfile.gettempdir()) / ".ddalab" / subdir
    d.mkdir(parents=True, exist_ok=True)
    tempf = tempfile.NamedTemporaryFile(dir=d, delete=False, **kwargs)
    return tempf


def make_dda_command(
    dda_binary_path: str,
    edf_file_name: str,
    out_file_name: str,
    channel_list: List[str],
    bounds: Tuple[int, int],
    cpu_time: bool,
    select_variants: Optional[List[str]] = None,
) -> List[str]:
    """
    Constructs a command list for DDA binary execution.

    Args:
        dda_binary_path: Path to the DDA binary
        edf_file_name: Input EDF file name
        out_file_name: Output file name
        channel_list: List of channel identifiers
        bounds: Tuple of (start, end) time bounds
        cpu_time: Flag to include CPU time measurement
        select_variants: Custom -SELECT parameter values (defaults to BASE_PARAMS)

    Returns:
        List of command arguments
    """
    # Base command components
    command = [
        dda_binary_path,
        "-DATA_FN",
        edf_file_name,
        "-OUT_FN",
        out_file_name,
        "-EDF",
        "-CH_list",
        *channel_list,
    ]

    # Add fixed parameters with optional SELECT override
    for flag, value in BASE_PARAMS.items():
        if flag == "-SELECT" and select_variants is not None:
            command.extend([flag, *select_variants])
        elif isinstance(value, list):
            command.extend([flag, *value])
        else:
            command.extend([flag, value])

    # Add optional bounds
    if "-1" not in map(str, bounds):  # Convert bounds to strings for comparison
        command.extend(["-StartEnd", str(bounds[0]), str(bounds[1])])

    # Add CPU time flag if requested
    if cpu_time:
        command.append("-CPUtime")

    return command


def get_env_var(key: str, default: str | None = None) -> str:
    """Get an environment variable with a default value if it's not set."""
    value = os.getenv(key)

    if value is None:
        if default is None:
            raise ValueError(f"Environment variable {key} is not set.")
        return default

    return value
