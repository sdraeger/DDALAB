#!/usr/bin/env python3
"""DDALAB launcher script."""

import os
import subprocess
import sys
import time
from pathlib import Path

from loguru import logger


def start_server():
    """Start the DDALAB server."""
    logger.info("Starting DDALAB server...")
    server_process = subprocess.Popen(
        ["uvicorn", "server.main:app", "--host", "localhost", "--port", "8001"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    # Wait a bit for server to start
    time.sleep(2)
    return server_process


def start_client():
    """Start the DDALAB client."""
    logger.info("Starting DDALAB client...")
    from PyQt6.QtWidgets import QApplication

    from ddalab.gui import DDALabWindow

    app = QApplication(sys.argv)
    window = DDALabWindow()
    window.show()
    return app.exec()


def main():
    """Main entry point."""
    # Configure logging
    logger.remove()  # Remove default handler
    logger.add(sys.stdout, level="INFO")  # Add stdout handler
    logger.add(
        Path.home() / ".ddalab/ddalab.log",
        rotation="10 MB",
        level="DEBUG",
    )  # Add file handler

    try:
        # Start server
        server_process = start_server()

        # Start client
        exit_code = start_client()

        # Clean up server process
        logger.info("Shutting down DDALAB server...")
        server_process.terminate()
        server_process.wait(timeout=5)

        sys.exit(exit_code)
    except Exception as e:
        logger.error(f"Error running DDALAB: {e}")
        if "server_process" in locals():
            server_process.terminate()
            server_process.wait(timeout=5)
        sys.exit(1)


if __name__ == "__main__":
    main()
