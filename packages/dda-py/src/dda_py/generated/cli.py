"""AUTO-GENERATED from DDA_SPEC.yaml
DO NOT EDIT - Changes will be overwritten

Generated at: 2025-11-15T17:53:55.973452+00:00
Spec version: 1.0.0
Generator: dda-codegen v0.1.0

DDA CLI Constants and Helper Functions
"""

import subprocess
import tempfile
import os
from pathlib import Path
from typing import List, Optional, Dict, Any
from dataclasses import dataclass


# Binary configuration
BINARY_NAME = "run_DDA_AsciiEdf"
REQUIRES_SHELL_WRAPPER = True


@dataclass
class DDARequest:
    """DDA Analysis Request Parameters"""
    file_path: str
    channels: List[int]  # 0-based channel indices
    variants: List[str]  # Variant abbreviations (e.g., ["ST", "SY"])
    window_length: int
    window_step: int
    delays: List[int]  # Delay values (tau) - e.g., [1, 2, 3, 4, 5]
    model_params: List[int] = None  # DDA model encoding (default: [1, 2, 10])
    time_range: Optional[tuple[float, float]] = None
    ct_window_length: Optional[int] = None
    ct_window_step: Optional[int] = None
    model_dimension: int = 4
    polynomial_order: int = 4
    num_tau: int = 2


class DDARunner:
    """DDA Binary Runner

    Handles execution of the run_DDA_AsciiEdf binary.
    """

    def __init__(self, binary_path: str):
        """Initialize DDA runner with binary path

        Args:
            binary_path: Path to the run_DDA_AsciiEdf binary

        Raises:
            FileNotFoundError: If binary does not exist
        """
        self.binary_path = Path(binary_path)
        if not self.binary_path.exists():
            raise FileNotFoundError(f"DDA binary not found: {binary_path}")

    def run(self, request: DDARequest) -> Dict[str, Any]:
        """Execute DDA analysis

        Args:
            request: DDA analysis parameters

        Returns:
            Dictionary containing analysis results

        Raises:
            FileNotFoundError: If input file does not exist
            RuntimeError: If DDA execution fails
        """
        # Validate input file
        input_file = Path(request.file_path)
        if not input_file.exists():
            raise FileNotFoundError(f"Input file not found: {request.file_path}")

        # Create temporary output file
        temp_dir = tempfile.gettempdir()
        output_base = os.path.join(temp_dir, f"dda_output_{os.getpid()}")

        # Build command
        cmd = self._build_command(request, output_base)

        # Execute binary
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True,
            )
        except subprocess.CalledProcessError as e:
            raise RuntimeError(
                f"DDA execution failed:\n"
                f"Command: {' '.join(cmd)}\n"
                f"Error: {e.stderr}"
            )

        # Parse results
        return self._parse_results(request, output_base)

    def _build_command(self, request: DDARequest, output_base: str) -> List[str]:
        """Build DDA command line arguments

        Args:
            request: DDA request parameters
            output_base: Base path for output files

        Returns:
            List of command arguments
        """
        from .variants import generate_select_mask

        cmd = []

        # Unix systems need shell wrapper for APE binaries
        if REQUIRES_SHELL_WRAPPER and os.name != 'nt':
            cmd.extend(['sh', str(self.binary_path)])
        else:
            cmd.append(str(self.binary_path))

        # File type
        if request.file_path.lower().endswith('.edf'):
            cmd.append('-EDF')
        else:
            cmd.append('-ASCII')

        # Input/Output files
        cmd.extend(['-DATA_FN', request.file_path])
        cmd.extend(['-OUT_FN', output_base])

        # Channel list (convert 0-based to 1-based)
        cmd.append('-CH_list')
        cmd.extend([str(ch + 1) for ch in request.channels])

        # SELECT mask
        mask = generate_select_mask(request.variants)
        cmd.append('-SELECT')
        cmd.extend([str(b) for b in mask])

        # Model parameters (DDA model encoding)
        model_params = request.model_params if request.model_params is not None else [1, 2, 10]
        cmd.append('-MODEL')
        cmd.extend([str(p) for p in model_params])

        # Delay values (tau)
        cmd.append('-TAU')
        cmd.extend([str(d) for d in request.delays])

        # Window parameters
        cmd.extend(['-WL', str(request.window_length)])
        cmd.extend(['-WS', str(request.window_step)])

        # CT window parameters (if needed)
        if request.ct_window_length is not None:
            cmd.extend(['-WL_CT', str(request.ct_window_length)])
        if request.ct_window_step is not None:
            cmd.extend(['-WS_CT', str(request.ct_window_step)])

        # Embedding parameters
        cmd.extend(['-dm', str(request.model_dimension)])
        cmd.extend(['-order', str(request.polynomial_order)])
        cmd.extend(['-nr_tau', str(request.num_tau)])

        # Time bounds (if specified)
        if request.time_range:
            start_sample = int(request.time_range[0])
            end_sample = int(request.time_range[1])
            cmd.extend(['-StartEnd', str(start_sample), str(end_sample)])

        return cmd

    def _parse_results(
        self,
        request: DDARequest,
        output_base: str
    ) -> Dict[str, Any]:
        """Parse DDA output files

        Args:
            request: Original request parameters
            output_base: Base path where output files were written

        Returns:
            Dictionary with parsed results for each variant
            Format: {
                'variant_abbrev': {
                    'channels': [
                        {
                            'channel_index': int,
                            'timepoints': [
                                {
                                    'window_start': int,
                                    'window_end': int,
                                    'coefficients': [float, ...],
                                    'error': float
                                },
                                ...
                            ]
                        },
                        ...
                    ],
                    'num_channels': int,
                    'num_timepoints': int,
                    'stride': int
                }
            }
        """
        from .variants import VARIANT_REGISTRY

        results = {}

        for variant_abbrev in request.variants:
            # Find variant metadata
            variant = None
            for v in VARIANT_REGISTRY:
                if v.abbreviation == variant_abbrev:
                    variant = v
                    break

            if variant is None:
                continue

            # Construct output file path
            output_file = Path(f"{output_base}{variant.output_suffix}")

            if not output_file.exists():
                raise FileNotFoundError(
                    f"Expected output file not found: {output_file}"
                )

            # Parse output file to structured format
            parsed_data = self._parse_output_file_structured(output_file, variant.stride)

            results[variant_abbrev] = {
                'channels': parsed_data['channels'],
                'num_channels': len(parsed_data['channels']),
                'num_timepoints': len(parsed_data['channels'][0]['timepoints']) if parsed_data['channels'] else 0,
                'stride': variant.stride,
            }

        return results

    def _parse_output_file_structured(
        self,
        file_path: Path,
        stride: int
    ) -> Dict[str, Any]:
        """Parse a DDA output file into structured format

        Args:
            file_path: Path to output file
            stride: Column stride for this variant (number of values per channel/pair)

        Returns:
            Dictionary with structured data:
            {
                'channels': [
                    {
                        'channel_index': int,
                        'timepoints': [
                            {
                                'window_start': int,
                                'window_end': int,
                                'coefficients': [float, ...],  # stride-1 coefficients
                                'error': float  # last value in stride group
                            },
                            ...
                        ]
                    },
                    ...
                ]
            }
        """
        # Read all lines from file
        raw_data = []
        with open(file_path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                values = [float(x) for x in line.split()]
                if values:
                    raw_data.append(values)

        if not raw_data:
            return {'channels': []}

        # Group data by channel/pair
        # Each row contains: window_start window_end [data for all channels/pairs]
        num_timepoints = len(raw_data)

        # Determine number of channels/pairs from row length
        # Format: window_start window_end [stride values per channel] * num_channels
        first_row = raw_data[0]
        data_columns = len(first_row) - 2  # Exclude window bounds

        if data_columns % stride != 0:
            raise ValueError(
                f"Invalid data format: {data_columns} data columns is not divisible by stride {stride}"
            )

        num_channels = data_columns // stride

        # Build structured output
        channels = []
        for channel_idx in range(num_channels):
            timepoints = []

            for row in raw_data:
                window_start = int(row[0])
                window_end = int(row[1])

                # Extract values for this channel/pair
                # Start at column 2 (skip window bounds), then offset by channel_idx * stride
                start_col = 2 + (channel_idx * stride)
                end_col = start_col + stride
                channel_values = row[start_col:end_col]

                # Split into coefficients and error
                # Last value in the stride group is the error
                if len(channel_values) >= 2:
                    coefficients = channel_values[:-1]
                    error = channel_values[-1]
                elif len(channel_values) == 1:
                    # For stride=1 (like SY), the single value could be error or coefficient
                    coefficients = []
                    error = channel_values[0]
                else:
                    coefficients = []
                    error = 0.0

                timepoints.append({
                    'window_start': window_start,
                    'window_end': window_end,
                    'coefficients': coefficients,
                    'error': error
                })

            channels.append({
                'channel_index': channel_idx,
                'timepoints': timepoints
            })

        return {'channels': channels}

    def _parse_output_file(
        self,
        file_path: Path,
        stride: int
    ) -> List[List[float]]:
        """Parse a DDA output file (legacy format for backward compatibility)

        Args:
            file_path: Path to output file
            stride: Column stride for this variant

        Returns:
            2D matrix [channels/pairs × timepoints]

        Note: This method only extracts the first value (coefficient) from each stride group.
        Use _parse_output_file_structured() to get all values including error.
        """
        matrix = []

        with open(file_path, 'r') as f:
            for line in f:
                # Skip comments and empty lines
                line = line.strip()
                if not line or line.startswith('#'):
                    continue

                # Parse values
                values = [float(x) for x in line.split()]
                if values:
                    matrix.append(values)

        if not matrix:
            return []

        # Skip first 2 columns (window bounds)
        matrix = [row[2:] for row in matrix]

        # Extract every Nth column starting from index 0
        extracted = []
        for row in matrix:
            row_values = []
            col_idx = 0
            while col_idx < len(row):
                row_values.append(row[col_idx])
                col_idx += stride
            extracted.append(row_values)

        if not extracted or not extracted[0]:
            return []

        # Transpose to [channels × timepoints]
        num_rows = len(extracted)
        num_cols = len(extracted[0])

        transposed = [[] for _ in range(num_cols)]
        for row in extracted:
            for col_idx, value in enumerate(row):
                transposed[col_idx].append(value)

        return transposed


# CLI Flags (for reference)
class Flags:
    """DDA CLI Flag Constants"""
    DATA_FILE = "-DATA_FN"
    OUTPUT_FILE = "-OUT_FN"
    CHANNEL_LIST = "-CH_list"
    SELECT_MASK = "-SELECT"
    MODEL = "-MODEL"
    DELAY_VALUES = "-TAU"
    MODEL_DIMENSION = "-dm"
    POLYNOMIAL_ORDER = "-order"
    NUM_TAU = "-nr_tau"
    WINDOW_LENGTH = "-WL"
    WINDOW_STEP = "-WS"
    CT_WINDOW_LENGTH = "-WL_CT"
    CT_WINDOW_STEP = "-WS_CT"
    TIME_BOUNDS = "-StartEnd"


# Default values
class Defaults:
    """Default parameter values"""
