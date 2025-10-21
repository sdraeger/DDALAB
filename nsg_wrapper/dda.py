#!/usr/bin/env python3
"""
Local DDA runner module with customizable parameters.
Based on dda-py but with fixes and customization support.
"""

import asyncio
import os
import platform
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

import numpy as np

__all__ = ["DDARunner", "init", "DDA_BINARY_PATH"]

DDA_BINARY_PATH: Optional[str] = None


def init(dda_binary_path: str) -> str:
    """Initialize the DDA binary path."""

    if not Path(dda_binary_path).exists():
        raise FileNotFoundError(f"DDA binary not found at {dda_binary_path}")

    global DDA_BINARY_PATH
    DDA_BINARY_PATH = dda_binary_path
    print(f"Set DDA_BINARY_PATH to {DDA_BINARY_PATH}")

    return DDA_BINARY_PATH


class DDARunner:
    """Handles DDA execution, both synchronously and asynchronously."""

    def __init__(self, binary_path: str = DDA_BINARY_PATH, base_params: Optional[Dict[str, Union[str, List[str]]]] = None):
        if not binary_path:
            raise ValueError(
                "DDA binary path must be initialized via init() or provided."
            )
        self.binary_path = binary_path

        # Default BASE_PARAMS (can be overridden)
        self.base_params = base_params or {
            "-dm": "4",
            "-order": "4",
            "-nr_tau": "2",
            "-WL": "125",
            "-WS": "62",
            "-SELECT": ["1", "0", "0", "0"],
            "-MODEL": ["1", "2", "10"],
            "-TAU": ["7", "10"],
        }

    @staticmethod
    def _create_tempfile(subdir: Optional[str] = None, **kwargs) -> Path:
        """Create a temporary file in the .dda directory."""

        d = Path(tempfile.gettempdir()) / ".dda" / (subdir or "")
        d.mkdir(parents=True, exist_ok=True)
        tempf = tempfile.NamedTemporaryFile(dir=d, delete=False, **kwargs)

        return Path(tempf.name)

    def _get_ape_command(self, binary_path: str) -> List[str]:
        """Get the proper command to execute an APE binary."""
        # APE (Actually Portable Executable) binaries need to be executed through sh on Unix systems
        system = platform.system()

        if system == "Darwin":  # macOS
            # On macOS, APE binaries need to be executed through sh
            return ["sh", binary_path]
        elif system == "Linux":
            # FIXED: On Linux, APE binaries also need sh wrapper
            return ["sh", binary_path]
        elif system == "Windows":
            # On Windows, APE binaries run directly
            return [binary_path]
        else:
            # Default to using sh for safety
            return ["sh", binary_path]

    def _make_command(
        self,
        input_file: str,
        output_file: str,
        channel_list: List[int],
        bounds: Optional[Tuple[int, int]] = None,
        cpu_time: bool = False,
        custom_params: Optional[Dict[str, Union[str, List[str]]]] = None,
    ) -> List[str]:
        """Construct a command list for DDA execution matching dda-rs EXACTLY."""

        # Get the proper command prefix for APE execution
        command = self._get_ape_command(self.binary_path)

        # Use custom params if provided, otherwise use instance base_params
        params_to_use = custom_params if custom_params is not None else self.base_params

        # Add arguments in EXACT order as dda-rs to avoid binary failures
        # 1. File parameters
        command.extend(["-DATA_FN", input_file, "-OUT_FN", output_file, "-EDF"])

        # 2. Channel list
        command.append("-CH_list")
        command.extend([str(ch) for ch in channel_list])

        # 3. Base parameters (in exact order from dda-rs)
        command.extend(["-dm", params_to_use["-dm"]])
        command.extend(["-order", params_to_use["-order"]])
        command.extend(["-nr_tau", params_to_use["-nr_tau"]])
        command.extend(["-WL", params_to_use["-WL"]])
        command.extend(["-WS", params_to_use["-WS"]])

        # 4. SELECT mask (as separate arguments)
        command.append("-SELECT")
        for bit in params_to_use["-SELECT"]:
            command.append(bit)

        # 5. MODEL parameters (as separate arguments)
        command.append("-MODEL")
        for val in params_to_use["-MODEL"]:
            command.append(val)

        # 6. TAU delay values (as separate arguments)
        command.append("-TAU")
        for tau in params_to_use["-TAU"]:
            command.append(tau)

        # 7. Time bounds (if provided)
        if bounds:
            command.extend(["-StartEnd", str(bounds[0]), str(bounds[1])])

        # 8. CPU time flag (if requested)
        if cpu_time:
            command.append("-CPUtime")

        return command

    @staticmethod
    def _process_output(output_path: Path) -> Tuple[np.ndarray, Path]:
        """Process the DDA output file and load the result."""

        # Handle the case where DDA binary creates filename.ext_ST instead of filename_ST
        # First try the expected format (filename_ST), then try the actual format (filename.ext_ST)
        st_path = output_path.with_name(f"{output_path.stem}_ST")
        if not st_path.exists():
            # Try the format that includes the original extension
            st_path = output_path.with_suffix(f"{output_path.suffix}_ST")

        if not st_path.exists():
            raise FileNotFoundError(f"DDA output file not found: {st_path}")

        # Check file size before loading
        file_size = st_path.stat().st_size
        print(f"DDA output file: {st_path}")
        print(f"File size: {file_size} bytes")

        if file_size == 0:
            raise ValueError(
                f"DDA output file is empty: {st_path}\n"
                "This usually means:\n"
                "  1. The binary couldn't read the input file (check filename/path)\n"
                "  2. Insufficient data for the window parameters\n"
                "  3. The binary crashed before writing output\n"
                "Check STDERR for binary error messages."
            )

        # Load the data
        try:
            Q = np.loadtxt(st_path)
        except Exception as e:
            raise ValueError(f"Failed to load DDA output file: {e}")

        # Handle empty or malformed data
        if Q.size == 0:
            raise ValueError("DDA output contains no data")

        if Q.ndim == 1:
            # Single row of data - reshape to 2D
            Q = Q.reshape(1, -1)

        # Process according to DDA format: skip first 2 columns and transpose
        if Q.shape[1] > 2:
            print(f"Loaded DDA output shape: {Q.shape}")
            Q = Q[:, 2:]  # Skip first 2 columns
            Q = Q[:, 0::4]  # Take every 4th column starting from column 0 (FIXED: was 1, should be 0 to match Rust implementation)
            Q = Q.T  # Transpose to get channels × time windows
            print(f"Processed DDA matrix shape: {Q.shape} (channels × time windows)")
        else:
            print(f"⚠️  Warning: DDA output has only {Q.shape[1]} columns, expected > 2")

        return Q, st_path

    def _prepare_execution(
        self,
        input_file: str,
        output_file: Optional[str],
        channel_list: List[int],
        bounds: Optional[Tuple[int, int]],
        cpu_time: bool,
        custom_params: Optional[Dict[str, Union[str, List[str]]]],
    ) -> Tuple[List[str], Path]:
        """Prepare command and output path for execution."""

        output_path = Path(output_file) if output_file else self._create_tempfile()
        command = self._make_command(
            input_file, str(output_path), channel_list, bounds, cpu_time, custom_params
        )

        return command, output_path

    def run(
        self,
        input_file: str,
        output_file: Optional[str] = None,
        channel_list: List[int] = [],
        bounds: Optional[Tuple[int, int]] = None,
        cpu_time: bool = False,
        raise_on_error: bool = True,
        custom_params: Optional[Dict[str, Union[str, List[str]]]] = None,
    ) -> Tuple[np.ndarray, Path]:
        """Run DDA synchronously with optional custom parameters."""

        command, output_path = self._prepare_execution(
            input_file, output_file, channel_list, bounds, cpu_time, custom_params
        )

        # Make binary executable if needed
        if not os.access(self.binary_path, os.X_OK):
            os.chmod(self.binary_path, 0o755)

        # Print command for debugging
        print(f"Executing DDA command: {' '.join(command)}")

        # Run APE binary
        process = subprocess.run(command, capture_output=True, text=True)

        print("\n" + "="*80)
        print("BINARY OUTPUT:")
        print("="*80)

        if process.stdout:
            print("STDOUT:")
            print(process.stdout)
        else:
            print("(no stdout)")

        if process.stderr:
            print("\nSTDERR:")
            print(process.stderr)
        else:
            print("(no stderr)")

        print("="*80)
        print(f"Exit code: {process.returncode}")
        print("="*80 + "\n")

        # Check if output file exists even if binary returned non-zero exit code
        # Some binaries (like DDA) may crash during cleanup but still produce valid output
        output_exists = False
        st_path = output_path.with_name(f"{output_path.stem}_ST")
        if not st_path.exists():
            st_path = output_path.with_suffix(f"{output_path.suffix}_ST")
        output_exists = st_path.exists()

        if process.returncode != 0:
            if output_exists:
                print(f"⚠️  Binary exited with code {process.returncode}, but output file exists. Continuing...")
            elif raise_on_error:
                raise subprocess.CalledProcessError(
                    process.returncode,
                    command,
                    output=process.stdout,
                    stderr=process.stderr,
                )

        return self._process_output(output_path)

    async def run_async(
        self,
        input_file: str,
        output_file: Optional[str] = None,
        channel_list: List[int] = [],
        bounds: Optional[Tuple[int, int]] = None,
        cpu_time: bool = False,
        raise_on_error: bool = True,
        custom_params: Optional[Dict[str, Union[str, List[str]]]] = None,
    ) -> Tuple[np.ndarray, Path]:
        """Run DDA asynchronously with optional custom parameters."""

        command, output_path = self._prepare_execution(
            input_file, output_file, channel_list, bounds, cpu_time, custom_params
        )

        # Make binary executable if needed
        if not os.access(self.binary_path, os.X_OK):
            os.chmod(self.binary_path, 0o755)

        # Print command for debugging
        print(f"Executing DDA command: {' '.join(command)}")

        # Run APE binary asynchronously
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await process.communicate()

        if stdout:
            print(stdout.decode())

        if stderr:
            print(f"STDERR: {stderr.decode()}", flush=True)

        # Check if output file exists even if binary returned non-zero exit code
        output_exists = False
        st_path = output_path.with_name(f"{output_path.stem}_ST")
        if not st_path.exists():
            st_path = output_path.with_suffix(f"{output_path.suffix}_ST")
        output_exists = st_path.exists()

        if process.returncode != 0:
            if output_exists:
                print(f"⚠️  Binary exited with code {process.returncode}, but output file exists. Continuing...")
            elif raise_on_error:
                raise subprocess.CalledProcessError(
                    process.returncode,
                    command,
                    output=stdout.decode() if stdout else "",
                    stderr=stderr.decode() if stderr else "",
                )

        return self._process_output(output_path)


# For backward compatibility or simpler usage
def run_dda(*args, **kwargs) -> Tuple[np.ndarray, Path]:
    """Synchronous DDA execution (global instance)."""
    return DDARunner(DDA_BINARY_PATH).run(*args, **kwargs)


async def run_dda_async(*args, **kwargs) -> Tuple[np.ndarray, Path]:
    """Asynchronous DDA execution (global instance)."""
    return await DDARunner(DDA_BINARY_PATH).run_async(*args, **kwargs)
