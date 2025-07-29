import concurrent.futures
import time
from typing import Dict, Optional, Tuple

import numpy as np
from core.edf.edf_file import EDFFile
from loguru import logger
from pyedflib import FILETYPE_EDF, EdfReader


def read_edf_chunk_cached(
    file_path: str,
    chunk_start: int = 0,
    chunk_size: int = 25_600,
    preprocessing_options: Optional[Dict] = None,
) -> Tuple[EDFFile, int]:
    """Read a chunk of data from an EDF file with caching optimization.

    This is the new optimized version that uses server-side caching.

    Args:
        file_path: Path to the EDF file
        chunk_start: Start position in samples
        chunk_size: Size of the chunk to read
        preprocessing_options: Optional preprocessing options

    Returns:
        Tuple of (EDFFile object, total_samples)
    """
    try:
        from core.edf.edf_cache import get_cache_manager

        cache_manager = get_cache_manager()
        return cache_manager.read_chunk_optimized(
            file_path, chunk_start, chunk_size, preprocessing_options
        )
    except ImportError:
        # Fallback to non-cached version if cache module is not available
        logger.warning(
            "EDF cache module not available, falling back to non-cached reading"
        )
        return read_edf_chunk(file_path, chunk_start, chunk_size, preprocessing_options)
    except Exception as e:
        logger.error(f"Cached reading failed, falling back to non-cached: {e}")
        return read_edf_chunk(file_path, chunk_start, chunk_size, preprocessing_options)


def _read_signal_parallel(args):
    """Helper function for parallel signal reading."""
    (
        reader,
        signal_idx,
        effective_chunk_start,
        effective_chunk_size,
        n_samples,
        signal_labels,
        preprocessing_options,
    ) = args

    try:
        signal_length = min(
            n_samples[signal_idx] - effective_chunk_start, effective_chunk_size
        )
        if signal_length <= 0:
            signal_data = np.zeros(1)
        else:
            signal_data = reader.readSignal(
                signal_idx, effective_chunk_start, signal_length
            )

        # Apply preprocessing if requested
        if preprocessing_options:
            signal_data = apply_preprocessing(signal_data, preprocessing_options)

        return signal_idx, EDFFile.Signal(
            data=signal_data,
            sampling_frequency=reader.getSampleFrequency(signal_idx),
            label=signal_labels[signal_idx],
        )
    except Exception as e:
        logger.error(f"Error reading signal {signal_idx}: {str(e)}")
        return signal_idx, EDFFile.Signal(
            data=np.zeros(effective_chunk_size),
            sampling_frequency=reader.getSampleFrequency(signal_idx)
            if signal_idx < len(n_samples)
            else 256,
            label=signal_labels[signal_idx]
            if signal_idx < len(signal_labels)
            else f"Signal_{signal_idx}",
        )


def read_edf_chunk(
    file_path: str,
    chunk_start: int = 0,
    chunk_size: int = 25_600,
    preprocessing_options: Optional[Dict] = None,
) -> Tuple[EDFFile, int]:
    """Read a chunk of data from an EDF file with parallel signal reading.

    This is the optimized version that reads signals in parallel for better performance.

    Args:
        file_path: Path to the EDF file
        chunk_start: Start position in samples
        chunk_size: Size of the chunk to read
        preprocessing_options: Optional preprocessing options

    Returns:
        Tuple of (EDFFile object, total_samples)
    """
    start_time = time.time()
    logger.info(
        f"Reading EDF chunk from {file_path}, start: {chunk_start}, size: {chunk_size}"
    )

    try:
        with EdfReader(file_path) as reader:
            edf_file = EDFFile()

            # Get file information
            n_signals = reader.signals_in_file
            signal_labels = reader.getSignalLabels()
            n_samples = reader.getNSamples()

            # Determine total samples (use first channel)
            total_samples = n_samples[0] if np.size(n_samples) > 0 else 0

            # Set chunk info
            main_freq = reader.getSampleFrequency(0) if n_signals > 0 else 256
            edf_file.sampling_frequencies = [main_freq] * n_signals
            edf_file.start_datetime = reader.getStartdatetime()
            edf_file.physical_maximum = reader.getPhysicalMaximum()
            edf_file.physical_minimum = reader.getPhysicalMinimum()
            edf_file.digital_maximum = reader.getDigitalMaximum()
            edf_file.digital_minimum = reader.getDigitalMinimum()
            edf_file.edf_type = FILETYPE_EDF

            # Apply bounds checking
            effective_chunk_start = min(chunk_start, total_samples)
            effective_chunk_size = min(
                chunk_size, total_samples - effective_chunk_start
            )

            # Read signals in parallel for better performance
            edf_file.labels = signal_labels

            # Prepare arguments for parallel processing
            args_list = [
                (
                    reader,
                    i,
                    effective_chunk_start,
                    effective_chunk_size,
                    n_samples,
                    signal_labels,
                    preprocessing_options,
                )
                for i in range(n_signals)
            ]

            # Use ThreadPoolExecutor for parallel signal reading
            # Limit max_workers to avoid overwhelming the system
            max_workers = min(
                n_signals, 8
            )  # Cap at 8 workers to avoid resource exhaustion

            with concurrent.futures.ThreadPoolExecutor(
                max_workers=max_workers
            ) as executor:
                # Submit all signal reading tasks
                future_to_signal = {
                    executor.submit(_read_signal_parallel, args): args[1]
                    for args in args_list
                }

                # Collect results in order
                signals = [None] * n_signals
                for future in concurrent.futures.as_completed(future_to_signal):
                    try:
                        signal_idx, signal = future.result()
                        signals[signal_idx] = signal
                    except Exception as e:
                        logger.error(f"Error in parallel signal reading: {e}")
                        # Fallback to sequential reading for this signal
                        signal_idx = future_to_signal[future]
                        signals[signal_idx] = _read_signal_parallel(
                            args_list[signal_idx]
                        )[1]

                # Add signals to edf_file in order
                for signal in signals:
                    if signal is not None:
                        edf_file.signals.append(signal)

            elapsed_time = time.time() - start_time
            logger.info(
                f"Chunk read completed in {elapsed_time:.3f}s for {n_signals} signals, {effective_chunk_size} samples"
            )

            return edf_file, total_samples
    except Exception as e:
        logger.error(f"Error reading EDF file: {str(e)}")

        # Create empty data on error
        edf_file = EDFFile()
        edf_file.labels = ["Error"]
        edf_file.signals.append(
            EDFFile.Signal(data=np.zeros(10), sampling_frequency=256, label="Error")
        )

        return edf_file, 10


def apply_preprocessing(data: np.ndarray, options: Dict) -> np.ndarray:
    """Apply preprocessing to the data.

    Args:
        data: Input signal data
        options: Preprocessing options

    Returns:
        Processed data
    """
    processed_data = data.copy()

    # Remove outliers
    if options.get("removeOutliers", False):
        q1, q3 = np.percentile(processed_data, [25, 75])
        iqr = q3 - q1
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr
        processed_data = np.clip(processed_data, lower_bound, upper_bound)

    # Apply smoothing
    if options.get("smoothing", False):
        window_size = options.get("smoothingWindow", 3)
        window_size = max(
            3, min(window_size, len(processed_data) // 10)
        )  # Ensure reasonable window size
        window_size = (
            window_size if window_size % 2 == 1 else window_size + 1
        )  # Make sure window size is odd

        # Simple moving average
        kernel = np.ones(window_size) / window_size
        processed_data = np.convolve(processed_data, kernel, mode="same")

    # Apply normalization
    normalization = options.get("normalization", "none")
    if normalization != "none":
        if normalization == "minmax":
            # Min-max normalization
            min_val = np.min(processed_data)
            max_val = np.max(processed_data)
            if max_val > min_val:
                processed_data = (processed_data - min_val) / (max_val - min_val)
        elif normalization == "zscore":
            # Z-score normalization
            mean = np.mean(processed_data)
            std = np.std(processed_data)
            if std > 0:
                processed_data = (processed_data - mean) / std

    return processed_data
