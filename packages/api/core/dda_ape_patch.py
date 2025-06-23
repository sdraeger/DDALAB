"""
APE (Actually Portable Executable) compatibility patch for dda_py.

This module patches dda_py to handle APE binaries that require shell execution
for proper bootstrapping instead of direct binary execution.
"""

import asyncio
import shlex
import subprocess
from typing import List, Optional, Tuple

import dda_py
from loguru import logger


def _is_ape_binary(binary_path: str) -> bool:
    """Check if a binary is an APE (Actually Portable Executable) format.

    APE binaries start with 'MZ' (DOS header) and contain shell script logic.
    """
    try:
        with open(binary_path, "rb") as f:
            header = f.read(16)
            return header.startswith(b"MZ") and b"'" in header
    except (OSError, IOError):
        return False


def _make_ape_compatible_command(command: List[str]) -> str:
    """Convert a command list to a shell-compatible command string for APE execution."""
    # For APE binaries, we need to execute via shell to allow bootstrapping
    return " ".join(shlex.quote(arg) for arg in command)


class APECompatibleDDARunner(dda_py.DDARunner):
    """APE-compatible DDA runner that uses shell execution for APE binaries."""

    def __init__(self, binary_path: str):
        super().__init__(binary_path)
        self._is_ape = _is_ape_binary(self.binary_path)
        if self._is_ape:
            logger.info(
                f"Detected APE binary format for {self.binary_path}, using shell execution"
            )

    def run(
        self,
        input_file: str,
        output_file: Optional[str] = None,
        channel_list: List[str] = [],
        bounds: Optional[Tuple[int, int]] = None,
        cpu_time: bool = False,
        raise_on_error: bool = False,
    ) -> Tuple:
        """Run DDA synchronously with APE compatibility."""

        command, output_path = self._prepare_execution(
            input_file, output_file, channel_list, bounds, cpu_time
        )

        if self._is_ape:
            # Use shell execution for APE binaries
            command_str = _make_ape_compatible_command(command)
            logger.debug(f"Executing APE command via shell: {command_str}")
            process = subprocess.run(
                command_str, shell=True, capture_output=True, text=True
            )
        else:
            # Use direct execution for regular binaries
            process = subprocess.run(command, capture_output=True, text=True)

        if raise_on_error and process.returncode != 0:
            logger.error(f"DDA execution failed with return code {process.returncode}")
            logger.error(f"stdout: {process.stdout}")
            logger.error(f"stderr: {process.stderr}")
            raise subprocess.CalledProcessError(
                process.returncode, command, process.stderr
            )

        return self._process_output(output_path)

    async def run_async(
        self,
        input_file: str,
        output_file: Optional[str] = None,
        channel_list: List[str] = [],
        bounds: Optional[Tuple[int, int]] = None,
        cpu_time: bool = False,
        raise_on_error: bool = False,
    ) -> Tuple:
        """Run DDA asynchronously with APE compatibility."""

        command, output_path = self._prepare_execution(
            input_file, output_file, channel_list, bounds, cpu_time
        )

        if self._is_ape:
            # Use shell execution for APE binaries
            command_str = _make_ape_compatible_command(command)
            logger.debug(f"Executing APE command via shell: {command_str}")
            process = await asyncio.create_subprocess_shell(
                command_str,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        else:
            # Use direct execution for regular binaries
            process = await asyncio.create_subprocess_exec(
                *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )

        await process.wait()

        if raise_on_error and process.returncode != 0:
            stderr = await process.stderr.read()
            stdout = await process.stdout.read()
            logger.error(
                f"DDA async execution failed with return code {process.returncode}"
            )
            logger.error(f"stdout: {stdout.decode()}")
            logger.error(f"stderr: {stderr.decode()}")
            raise subprocess.CalledProcessError(
                process.returncode, command, stderr.decode()
            )

        return self._process_output(output_path)


def patch_dda_py():
    """Apply APE compatibility patch to dda_py module."""
    logger.info("Applying APE compatibility patch to dda_py")

    # Import here to avoid circular imports
    from core.config import get_server_settings

    # Replace the original DDARunner with our APE-compatible version
    original_runner = dda_py.DDARunner
    dda_py.DDARunner = APECompatibleDDARunner

    # Patch the module-level functions to use the new runner
    async def patched_run_dda_async(*args, **kwargs):
        """Patched async DDA execution with APE compatibility."""
        settings = get_server_settings()
        runner = APECompatibleDDARunner(settings.dda_binary_path)
        return await runner.run_async(*args, **kwargs)

    def patched_run_dda(*args, **kwargs):
        """Patched sync DDA execution with APE compatibility."""
        settings = get_server_settings()
        runner = APECompatibleDDARunner(settings.dda_binary_path)
        return runner.run(*args, **kwargs)

    dda_py.run_dda_async = patched_run_dda_async
    dda_py.run_dda = patched_run_dda

    logger.info("APE compatibility patch applied successfully")
    return original_runner


def unpatch_dda_py(original_runner):
    """Remove APE compatibility patch from dda_py module."""
    logger.info("Removing APE compatibility patch from dda_py")
    dda_py.DDARunner = original_runner
