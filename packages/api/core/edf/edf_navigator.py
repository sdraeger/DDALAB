"""EDF file reader implementation."""

import concurrent.futures
from typing import Dict, List

import numpy as np
from core.edf.edf_file import EDFFile
from loguru import logger
from pyedflib import FILETYPE_EDF, EdfReader, EdfWriter
from schemas.edf.segment import Segment


def _read_segment_signal_parallel(args):
    """Helper function for parallel signal reading during segmentation."""
    reader, signal_idx, start_sample, n_samples = args

    try:
        signal_data = reader.readSignal(signal_idx, start_sample, n_samples)
        return signal_idx, signal_data
    except Exception as e:
        logger.error(f"Error reading signal {signal_idx} during segmentation: {str(e)}")
        return signal_idx, np.zeros(n_samples)


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
        self.start_datetime = None
        self.physical_maximum = None
        self.physical_minimum = None
        self.digital_maximum = None
        self.digital_minimum = None
        self._load_metadata()

    def _load_metadata(self):
        """Load file metadata without reading all data."""
        with EdfReader(self.file_path) as reader:
            self.num_signals = reader.signals_in_file
            self.signal_labels = reader.getSignalLabels()
            self.sampling_frequencies = [
                reader.getSampleFrequency(i) for i in range(self.num_signals)
            ]
            self.n_samples = reader.getNSamples()
            # Fix numpy array boolean context issue
            if self.n_samples is not None and len(self.n_samples) > 0:
                self.total_samples = self.n_samples[0]
            else:
                self.total_samples = 0
            self.file_duration_seconds = (
                self.total_samples / self.sampling_frequencies[0]
                if self.sampling_frequencies and self.sampling_frequencies[0] > 0
                else 0
            )
            self.start_datetime = reader.getStartdatetime()
            self.physical_maximum = reader.getPhysicalMaximum()
            self.physical_minimum = reader.getPhysicalMinimum()
            self.digital_maximum = reader.getDigitalMaximum()
            self.digital_minimum = reader.getDigitalMinimum()

    def get_chunk_size(self, chunk_size_seconds: float) -> int:
        """Get chunk size in samples for given duration."""
        sfreq = self.sampling_frequencies[0] if self.sampling_frequencies else 256
        return int(chunk_size_seconds * sfreq)

    def get_navigation_info(self) -> Dict:
        """Get navigation information for the file."""
        return {
            "total_samples": self.total_samples,
            "file_duration_seconds": self.file_duration_seconds,
            "num_signals": self.num_signals,
            "signal_labels": self.signal_labels,
            "sampling_frequencies": self.sampling_frequencies,
        }

    def get_chunk_ranges(self, chunk_size: int = 25_600) -> List[Dict]:
        """Get chunk ranges for the file."""
        chunks = []
        for i in range(0, self.total_samples, chunk_size):
            end = min(i + chunk_size, self.total_samples)
            time_seconds = (
                i / self.sampling_frequencies[0] if self.sampling_frequencies else 0
            )
            position_seconds = time_seconds
            chunks.append(
                {
                    "start": i,
                    "end": end,
                    "size": end - i,
                    "time_seconds": time_seconds,
                    "position_seconds": position_seconds,
                }
            )
        return chunks

    def get_chunk_at_time(self, time_seconds: float, chunk_size: int = 25_600) -> Dict:
        """Get chunk information for a specific time."""
        sample = (
            int(time_seconds * self.sampling_frequencies[0])
            if self.sampling_frequencies
            else 0
        )
        chunk_start = (sample // chunk_size) * chunk_size
        chunk_end = min(chunk_start + chunk_size, self.total_samples)
        return {
            "start": chunk_start,
            "end": chunk_end,
            "size": chunk_end - chunk_start,
            "time_seconds": chunk_start / self.sampling_frequencies[0]
            if self.sampling_frequencies
            else 0,
            "position_seconds": chunk_start / self.sampling_frequencies[0]
            if self.sampling_frequencies
            else 0,
        }

    def segment(self, segment: Segment) -> EDFFile:
        """Segment the file using parallel signal reading for better performance."""

        with EdfReader(self.file_path) as reader:
            sfreq = self.sampling_frequencies[0] if self.sampling_frequencies else 256
            start_sample = int(
                segment.start.days * 86400 * sfreq
                + segment.start.hours * 3600 * sfreq
                + segment.start.minutes * 60 * sfreq
                + segment.start.seconds * sfreq
            )
            end_sample = int(
                segment.end.days * 86400 * sfreq
                + segment.end.hours * 3600 * sfreq
                + segment.end.minutes * 60 * sfreq
                + segment.end.seconds * sfreq
            )
            n_samples = end_sample - start_sample
            # Ensure n_samples is a multiple of sfreq (whole number of seconds)
            if n_samples % sfreq != 0:
                n_samples = (n_samples // sfreq) * sfreq
                end_sample = start_sample + n_samples

            # Calculate expected duration for validation
            expected_duration_seconds = n_samples / sfreq
            requested_duration_seconds = (
                (segment.end.days - segment.start.days) * 86400
                + (segment.end.hours - segment.start.hours) * 3600
                + (segment.end.minutes - segment.start.minutes) * 60
                + (segment.end.seconds - segment.start.seconds)
            )

            logger.info(
                f"Reading segment from {start_sample} to {end_sample} (n_samples={n_samples})"
            )
            logger.info(
                f"Segment duration: {expected_duration_seconds:.2f}s (requested: {requested_duration_seconds:.2f}s)"
            )

            # Use parallel processing for signal reading during segmentation
            args_list = [
                (reader, i, start_sample, n_samples) for i in range(self.num_signals)
            ]

            # Use ThreadPoolExecutor for parallel signal reading
            max_workers = min(self.num_signals, 8)  # Cap at 8 workers

            with concurrent.futures.ThreadPoolExecutor(
                max_workers=max_workers
            ) as executor:
                # Submit all signal reading tasks
                future_to_signal = {
                    executor.submit(_read_segment_signal_parallel, args): args[1]
                    for args in args_list
                }

                # Collect results in order
                data = [None] * self.num_signals
                for future in concurrent.futures.as_completed(future_to_signal):
                    try:
                        signal_idx, signal_data = future.result()
                        data[signal_idx] = signal_data
                    except Exception as e:
                        logger.error(
                            f"Error in parallel signal reading during segmentation: {e}"
                        )
                        # Fallback to sequential reading for this signal
                        signal_idx = future_to_signal[future]
                        data[signal_idx] = _read_segment_signal_parallel(
                            args_list[signal_idx]
                        )[1]

            return EDFFile(
                data,
                self.signal_labels,
                self.sampling_frequencies,
                self.start_datetime,
                self.physical_maximum,
                self.physical_minimum,
                self.digital_maximum,
                self.digital_minimum,
                FILETYPE_EDF,
            )

    def write_file(self, edf_file: EDFFile, file_path: str) -> bool:
        """Write a segment to the EDF file."""

        try:
            with EdfWriter(
                file_path,
                len(edf_file.signals),
                file_type=edf_file.edf_type,
            ) as writer:
                # Set signal headers for proper EDF file structure
                for i in range(len(edf_file.signals)):
                    writer.setLabel(i, edf_file.labels[i])

                    # Ensure sampling frequency is properly set
                    if i < len(edf_file.sampling_frequencies):
                        writer.setSamplefrequency(i, edf_file.sampling_frequencies[i])
                    else:
                        # Fallback to first sampling frequency if array is too short
                        writer.setSamplefrequency(
                            i,
                            edf_file.sampling_frequencies[0]
                            if edf_file.sampling_frequencies
                            else 256,
                        )

                    if i < len(edf_file.physical_maximum):
                        writer.setPhysicalMaximum(i, edf_file.physical_maximum[i])
                    if i < len(edf_file.physical_minimum):
                        writer.setPhysicalMinimum(i, edf_file.physical_minimum[i])
                    if i < len(edf_file.digital_maximum):
                        writer.setDigitalMaximum(i, edf_file.digital_maximum[i])
                    if i < len(edf_file.digital_minimum):
                        writer.setDigitalMinimum(i, edf_file.digital_minimum[i])
                writer.setStartdatetime(edf_file.start_datetime)
                # Write samples in blocks matching the data record structure
                writer.writeSamples(edf_file.signals)
        except Exception as e:
            logger.error(f"Error writing segment to file: {str(e)}")
            return False

        return True


def get_edf_navigator(file_path: str) -> EDFNavigator:
    """Get an EDFNavigator for an EDF file.

    Args:
        file_path: Path to the EDF file

    Returns:
        EDFNavigator instance
    """
    return EDFNavigator(file_path)
