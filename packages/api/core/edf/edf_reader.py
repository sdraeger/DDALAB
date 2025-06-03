"""EDF file reader implementation."""

from typing import Dict, List, Optional, Tuple

import numpy as np
from loguru import logger
from pyedflib import EdfReader


class EDFNavigator:
    """Navigator for EDF files that provides metadata and navigation capabilities."""

    def __init__(self, file_path: str):
        """Initialize the EDFNavigator with an EDF file.

        Args:
            file_path: Path to the EDF file
        """
        self.file_path = file_path
        self.total_samples = 0
        self.num_signals = 0
        self.signal_labels = []
        self.sampling_frequencies = []
        self.file_duration_seconds = 0
        self._load_metadata()

    def _load_metadata(self):
        """Load metadata from the EDF file."""
        try:
            with EdfReader(self.file_path) as reader:
                self.num_signals = reader.signals_in_file
                self.signal_labels = reader.getSignalLabels()
                self.sampling_frequencies = [
                    reader.getSampleFrequency(i) for i in range(self.num_signals)
                ]

                # Use the first channel's sampling frequency to calculate duration
                main_freq = (
                    self.sampling_frequencies[0] if self.sampling_frequencies else 256
                )
                self.total_samples = reader.getNSamples()[
                    0
                ]  # Use the first channel's sample count
                self.file_duration_seconds = self.total_samples / main_freq

        except ImportError:
            logger.error("pyedflib not available, using mock data for EDFNavigator")
            # Provide mock data if pyedflib is not available
            self.total_samples = 512000  # 1000 seconds at 512 Hz
            self.num_signals = 1
            self.signal_labels = ["EEG"]
            self.sampling_frequencies = [512]
            self.file_duration_seconds = 1000
        except Exception as e:
            logger.error(f"Error loading EDF metadata: {str(e)}")
            # Provide fallback values
            self.total_samples = 512000
            self.num_signals = 1
            self.signal_labels = ["EEG"]
            self.sampling_frequencies = [512]
            self.file_duration_seconds = 1000

    def get_chunk_size(self, chunk_size_seconds: float) -> int:
        """Get the chunk size for the EDF file.

        Returns:
            Chunk size in samples
        """
        return int(chunk_size_seconds * self.sampling_frequencies[0])

    def get_navigation_info(self) -> Dict:
        """Get navigation information for the EDF file.

        Returns:
            Dictionary with file metadata useful for navigation
        """
        return {
            "totalSamples": self.total_samples,
            "numSignals": self.num_signals,
            "signalLabels": self.signal_labels,
            "samplingFrequencies": self.sampling_frequencies,
            "fileDurationSeconds": self.file_duration_seconds,
        }

    def get_chunk_ranges(self, chunk_size: int = 25_600) -> List[Dict]:
        """Get a list of all possible chunk ranges for the file.

        Args:
            chunk_size: Size of each chunk in samples

        Returns:
            List of dictionaries with start and end positions for each chunk
        """
        chunks = []
        remaining_samples = self.total_samples
        start_position = 0

        while remaining_samples > 0:
            size = min(chunk_size, remaining_samples)
            main_freq = (
                self.sampling_frequencies[0] if self.sampling_frequencies else 256
            )
            chunks.append(
                {
                    "start": start_position,
                    "end": start_position + size,
                    "size": size,
                    "timeSeconds": size / main_freq,
                    "positionSeconds": start_position / main_freq,
                }
            )
            start_position += size
            remaining_samples -= size

        return chunks

    def get_chunk_at_time(self, time_seconds: float, chunk_size: int = 25_600) -> Dict:
        """Get the chunk information for a specific time position.

        Args:
            time_seconds: Time position in seconds
            chunk_size: Size of the chunk to read

        Returns:
            Dictionary with start and end positions for the chunk
        """
        sample_freq = self.sampling_frequencies[0] if self.sampling_frequencies else 256
        target_sample = int(time_seconds * sample_freq)

        # Ensure we get a properly aligned chunk
        chunk_start = max(0, min(target_sample, self.total_samples - 1))
        chunk_end = min(chunk_start + chunk_size, self.total_samples)

        return {
            "start": chunk_start,
            "end": chunk_end,
            "size": chunk_end - chunk_start,
            "timeSeconds": (chunk_end - chunk_start) / sample_freq,
            "positionSeconds": chunk_start / sample_freq,
        }


class EDFFile:
    """Representation of an EDF file with signals."""

    def __init__(self):
        """Initialize an empty EDF file object."""
        self.signals = []
        self.labels = []
        self.chunk_info = None

    class Signal:
        """Representation of a signal in an EDF file."""

        def __init__(self, data: np.ndarray, sampling_frequency: float, label: str):
            """Initialize a signal.

            Args:
                data: Signal data
                sampling_frequency: Sampling frequency in Hz
                label: Signal label
            """
            self.data = data
            self.sampling_frequency = sampling_frequency
            self.label = label


def get_edf_navigator(file_path: str) -> EDFNavigator:
    """Get an EDFNavigator for an EDF file.

    Args:
        file_path: Path to the EDF file

    Returns:
        EDFNavigator instance
    """
    return EDFNavigator(file_path)


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
        from .edf_cache import get_cache_manager

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


def read_edf_chunk(
    file_path: str,
    chunk_start: int = 0,
    chunk_size: int = 25_600,
    preprocessing_options: Optional[Dict] = None,
) -> Tuple[EDFFile, int]:
    """Read a chunk of data from an EDF file.

    This is the original non-cached version, kept for compatibility and fallback.

    Args:
        file_path: Path to the EDF file
        chunk_start: Start position in samples
        chunk_size: Size of the chunk to read
        preprocessing_options: Optional preprocessing options

    Returns:
        Tuple of (EDFFile object, total_samples)
    """
    logger.info(
        f"Reading EDF chunk from {file_path}, start: {chunk_start}, size: {chunk_size}"
    )

    try:
        # Try to use pyedflib to read the file
        from pyedflib import EdfReader

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
            edf_file.chunk_info = {
                "start": chunk_start,
                "end": min(chunk_start + chunk_size, total_samples),
                "size": min(chunk_size, total_samples - chunk_start),
                "time_seconds": min(chunk_size, total_samples - chunk_start)
                / main_freq,
                "position_seconds": chunk_start / main_freq,
            }

            # Apply bounds checking
            effective_chunk_start = min(chunk_start, total_samples)
            effective_chunk_size = min(
                chunk_size, total_samples - effective_chunk_start
            )

            # Read signals and apply preprocessing if needed
            edf_file.labels = signal_labels

            for i in range(n_signals):
                # Read the data for this signal
                try:
                    signal_length = min(
                        n_samples[i] - effective_chunk_start, effective_chunk_size
                    )
                    if signal_length <= 0:
                        # Add empty data if out of bounds
                        signal_data = np.zeros(1)
                    else:
                        signal_data = reader.readSignal(
                            i, effective_chunk_start, signal_length
                        )

                    # Apply preprocessing if requested
                    if preprocessing_options:
                        signal_data = apply_preprocessing(
                            signal_data, preprocessing_options
                        )

                    # Create signal object
                    signal = EDFFile.Signal(
                        data=signal_data,
                        sampling_frequency=reader.getSampleFrequency(i),
                        label=signal_labels[i],
                    )
                    edf_file.signals.append(signal)

                except Exception as e:
                    logger.error(f"Error reading signal {i}: {str(e)}")
                    # Add empty signal on error
                    edf_file.signals.append(
                        EDFFile.Signal(
                            data=np.zeros(effective_chunk_size),
                            sampling_frequency=reader.getSampleFrequency(i)
                            if i < n_signals
                            else 256,
                            label=signal_labels[i]
                            if i < len(signal_labels)
                            else f"Signal_{i}",
                        )
                    )

            return edf_file, total_samples

    except ImportError:
        logger.warning("pyedflib not available, using mock data")
        # Create mock data if pyedflib is not available
        edf_file = EDFFile()
        total_samples = 512000  # 1000 seconds at 512 Hz

        # Set chunk info
        sample_rate = 512
        edf_file.chunk_info = {
            "start": chunk_start,
            "end": min(chunk_start + chunk_size, total_samples),
            "size": min(chunk_size, total_samples - chunk_start),
            "time_seconds": min(chunk_size, total_samples - chunk_start) / sample_rate,
            "position_seconds": chunk_start / sample_rate,
        }

        # Create a simple sine wave as mock data
        t = np.arange(chunk_size) / sample_rate
        mock_data = np.sin(2 * np.pi * 10 * t)  # 10 Hz sine wave

        # Apply preprocessing if requested
        if preprocessing_options:
            mock_data = apply_preprocessing(mock_data, preprocessing_options)

        # Add signal to file
        edf_file.labels = ["EEG"]
        edf_file.signals.append(
            EDFFile.Signal(data=mock_data, sampling_frequency=sample_rate, label="EEG")
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
