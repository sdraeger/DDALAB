"""Utility functions for the server."""

import hashlib
from pathlib import Path


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
