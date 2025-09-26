"""
APE (Actually Portable Executable) compatibility patch for dda_py.

This module patches dda_py to handle APE binaries that require shell execution
for proper bootstrapping instead of direct binary execution.
"""

import asyncio
import shlex
import subprocess
from typing import List, Optional, Tuple
from pathlib import Path

import dda_py
from loguru import logger

# Set debug level for this module
logger.enable("core.dda_ape_patch")


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
    # Convert all arguments to strings first to handle numeric values
    return " ".join(shlex.quote(str(arg)) for arg in command)


class APECompatibleDDARunner(dda_py.DDARunner):
    """APE-compatible DDA runner that uses shell execution for APE binaries."""

    def __init__(self, binary_path: str):
        super().__init__(binary_path)
        self._is_ape = _is_ape_binary(self.binary_path)
        if self._is_ape:
            logger.info(
                f"Detected APE binary format for {self.binary_path}, using shell execution"
            )

    def _prepare_execution(
        self,
        input_file: str,
        output_file: Optional[str] = None,
        channel_list: List[str] = [],
        bounds: Optional[Tuple[int, int]] = None,
        cpu_time: bool = False,
        select_variants: Optional[List[str]] = None,
    ) -> Tuple[List[str], Path]:
        """Override _prepare_execution to support custom variant selection."""
        from core.utils.utils import make_dda_command, create_tempfile
        
        # Create output file if not provided
        if output_file is None:
            temp_file = create_tempfile("dda_output", suffix=".txt")
            output_file = temp_file.name
            temp_file.close()
        
        # Build command with optional variant selection
        command = make_dda_command(
            dda_binary_path=self.binary_path,
            edf_file_name=input_file,
            out_file_name=output_file,
            channel_list=channel_list,
            bounds=bounds if bounds else (-1, -1),
            cpu_time=cpu_time,
            select_variants=select_variants,
        )
        
        # Return command and Path object (not string) to match parent class interface
        return command, Path(output_file)

    def run(
        self,
        input_file: str,
        output_file: Optional[str] = None,
        channel_list: List[str] = [],
        bounds: Optional[Tuple[int, int]] = None,
        cpu_time: bool = False,
        raise_on_error: bool = False,
        select_variants: Optional[List[str]] = None,
    ) -> Tuple:
        """Run DDA synchronously with APE compatibility."""

        command, output_path = self._prepare_execution(
            input_file, output_file, channel_list, bounds, cpu_time, select_variants
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
            # Convert all command arguments to strings to avoid TypeError
            string_command = [str(arg) for arg in command]
            process = subprocess.run(string_command, capture_output=True, text=True)

        # Log the output for debugging
        logger.debug(f"DDA process return code: {process.returncode}")
        if process.stdout:
            logger.debug(f"DDA stdout: {process.stdout}")
        if process.stderr:
            logger.debug(f"DDA stderr: {process.stderr}")

        if raise_on_error and process.returncode != 0:
            logger.error(f"DDA execution failed with return code {process.returncode}")
            logger.error(f"stdout: {process.stdout}")
            logger.error(f"stderr: {process.stderr}")
            raise subprocess.CalledProcessError(
                process.returncode, command, process.stderr
            )

        # Check what files were created
        output_dir = output_path.parent
        logger.debug(f"Output directory: {output_dir}")
        logger.debug(f"Expected output file: {output_path}")
        logger.debug(f"Expected ST file: {output_path.with_name(f'{output_path.stem}_ST')}")
        
        if output_dir.exists():
            files = list(output_dir.glob("*"))
            logger.debug(f"Files in output directory: {[f.name for f in files]}")
        else:
            logger.error(f"Output directory does not exist: {output_dir}")

        return self._process_output_with_variants(output_path, select_variants)

    async def run_async(
        self,
        input_file: str,
        output_file: Optional[str] = None,
        channel_list: List[str] = [],
        bounds: Optional[Tuple[int, int]] = None,
        cpu_time: bool = False,
        raise_on_error: bool = False,
        select_variants: Optional[List[str]] = None,
    ) -> Tuple:
        """Run DDA asynchronously with APE compatibility."""

        command, output_path = self._prepare_execution(
            input_file, output_file, channel_list, bounds, cpu_time, select_variants
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
            # Convert all command arguments to strings to avoid TypeError
            string_command = [str(arg) for arg in command]
            process = await asyncio.create_subprocess_exec(
                *string_command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )

        stdout, stderr = await process.communicate()
        
        # Log the output for debugging
        logger.debug(f"DDA process return code: {process.returncode}")
        if stdout:
            logger.debug(f"DDA stdout: {stdout.decode()}")
        if stderr:
            logger.debug(f"DDA stderr: {stderr.decode()}")

        if raise_on_error and process.returncode != 0:
            logger.error(
                f"DDA async execution failed with return code {process.returncode}"
            )
            logger.error(f"stdout: {stdout.decode()}")
            logger.error(f"stderr: {stderr.decode()}")
            raise subprocess.CalledProcessError(
                process.returncode, command, stderr.decode()
            )

        # Check what files were created
        output_dir = output_path.parent
        logger.debug(f"Output directory: {output_dir}")
        logger.debug(f"Expected output file: {output_path}")
        logger.debug(f"Expected ST file: {output_path.with_name(f'{output_path.stem}_ST')}")
        
        if output_dir.exists():
            files = list(output_dir.glob("*"))
            logger.debug(f"Files in output directory: {[f.name for f in files]}")
        else:
            logger.error(f"Output directory does not exist: {output_dir}")
        
        return self._process_output_with_variants(output_path, select_variants)

    def _process_output_with_variants(self, output_path: Path, select_variants: Optional[List[str]] = None) -> Tuple:
        """Process DDA output files and look for variant-specific results."""
        logger.debug(f"Processing DDA output with variants. Base output: {output_path}")
        
        # Map select_variants array to variant names
        variant_mapping = {
            0: "single_timeseries",
            1: "cross_timeseries", 
            2: "cross_dynamical",
            3: "dynamical_ergodicity"
        }
        
        # Determine which variants were selected
        selected_variants = []
        if select_variants:
            for i, selected in enumerate(select_variants):
                if selected == "1" and i in variant_mapping:
                    selected_variants.append(variant_mapping[i])
        else:
            selected_variants = ["single_timeseries"]  # Default
            
        logger.debug(f"Expected variant files: {selected_variants}")
        
        # Check for variant-specific output files
        variant_results = {}
        output_dir = output_path.parent
        base_name = output_path.stem
        
        # Common suffix patterns the DDA binary might use
        suffix_patterns = {
            "single_timeseries": ["_ST", ""],  # ST might be default or have _ST suffix
            "cross_timeseries": ["_CT"],
            "cross_dynamical": ["_CD"], 
            "dynamical_ergodicity": ["_DE"]
        }
        
        for variant_id in selected_variants:
            patterns = suffix_patterns.get(variant_id, [f"_{variant_id.upper()}"])
            variant_data = None
            
            for suffix in patterns:
                variant_file = output_dir / f"{base_name}{suffix}.txt"
                logger.debug(f"Looking for variant file: {variant_file}")
                
                if variant_file.exists():
                    logger.info(f"Found variant file for {variant_id}: {variant_file}")
                    try:
                        # Use the parent class method to process this specific file
                        Q_variant, meta_variant = self._process_output(variant_file)
                        variant_data = {
                            "Q": Q_variant,
                            "metadata": meta_variant,
                            "exponents": {},  # Would need specific calculation for each variant
                            "quality_metrics": {}
                        }
                        break
                    except Exception as e:
                        logger.warning(f"Failed to process variant file {variant_file}: {e}")
                        continue
                        
            if variant_data:
                variant_results[variant_id] = variant_data
            else:
                logger.warning(f"No output file found for variant {variant_id}")
        
        # If we found variant-specific results, return them
        if variant_results:
            logger.info(f"Successfully processed {len(variant_results)} variant-specific files")
            # Return the first variant's Q matrix as main result (for backward compatibility)
            # and include all variants in metadata
            first_variant = list(variant_results.values())[0]
            main_Q = first_variant["Q"]
            
            # Create combined metadata with variant results
            combined_metadata = {
                "variant_results": variant_results,
                "dda_output_file": str(output_path)
            }
            
            return main_Q, combined_metadata
        else:
            # Fallback to standard processing if no variant files found
            logger.info("No variant-specific files found, using standard output processing")
            return self._process_output(output_path)


def patch_dda_py():
    """Apply APE compatibility patch to dda_py module."""
    logger.info("Applying APE compatibility patch to dda_py")

    # Import here to avoid circular imports
    from core.environment import get_config_service

    # Replace the original DDARunner with our APE-compatible version
    original_runner = dda_py.DDARunner
    dda_py.DDARunner = APECompatibleDDARunner

    # Patch the module-level functions to use the new runner
    async def patched_run_dda_async(*args, **kwargs):
        """Patched async DDA execution with APE compatibility."""
        dda_settings = get_config_service().get_dda_settings()
        runner = APECompatibleDDARunner(dda_settings.dda_binary_path)
        return await runner.run_async(*args, **kwargs)

    def patched_run_dda(*args, **kwargs):
        """Patched sync DDA execution with APE compatibility."""
        dda_settings = get_config_service().get_dda_settings()
        runner = APECompatibleDDARunner(dda_settings.dda_binary_path)
        return runner.run(*args, **kwargs)

    dda_py.run_dda_async = patched_run_dda_async
    dda_py.run_dda = patched_run_dda

    logger.info("APE compatibility patch applied successfully")
    return original_runner


def unpatch_dda_py(original_runner):
    """Remove APE compatibility patch from dda_py module."""
    logger.info("Removing APE compatibility patch from dda_py")
    dda_py.DDARunner = original_runner
