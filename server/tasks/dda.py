"""DDA task definitions."""

from typing import Dict, Optional

import numpy as np
from scipy import signal

from ..celery_app import celery_app

__all__ = ["run_dda", "cleanup_task"]  # Export task names


def preprocess_data(
    data: np.ndarray, sampling_rate: float, options: Optional[Dict[str, bool]] = None
) -> np.ndarray:
    """Preprocess the data according to the specified options.

    Args:
        data: Raw data array
        sampling_rate: Original sampling rate in Hz
        options: Dictionary of preprocessing options

    Returns:
        Preprocessed data array
    """
    if not options:
        return data

    processed_data = data.copy()

    # Resampling
    if options.get("resample1000hz") and sampling_rate != 1000:
        new_length = int(len(data) * 1000 / sampling_rate)
        processed_data = signal.resample(processed_data, new_length)
    elif options.get("resample500hz") and sampling_rate != 500:
        new_length = int(len(data) * 500 / sampling_rate)
        processed_data = signal.resample(processed_data, new_length)

    # Filtering
    nyquist = sampling_rate / 2
    if options.get("lowpassFilter"):
        b, a = signal.butter(4, 40 / nyquist, btype="low")
        processed_data = signal.filtfilt(b, a, processed_data)

    if options.get("highpassFilter"):
        b, a = signal.butter(4, 0.5 / nyquist, btype="high")
        processed_data = signal.filtfilt(b, a, processed_data)

    if options.get("notchFilter"):
        for freq in [50, 60]:  # Both 50Hz and 60Hz
            b, a = signal.iirnotch(freq, 30, sampling_rate)
            processed_data = signal.filtfilt(b, a, processed_data)

    if options.get("detrend"):
        processed_data = signal.detrend(processed_data)

    return processed_data


@celery_app.task(
    name="server.tasks.dda.run_dda", bind=True, ignore_result=False, track_started=True
)
def run_dda(
    self,  # Celery task instance
    file_path: str,
    preprocessing_options: Optional[Dict[str, bool]] = None,
) -> Dict:
    """Run DDA on a file.

    Args:
        self: Celery task instance
        file_path: Path to the file to analyze
        preprocessing_options: Dictionary of preprocessing options

    Returns:
        Dictionary containing DDA results
    """
    self.update_state(state="STARTED", meta={"file_path": file_path})
    print(f"[Task {self.request.id}] Starting DDA analysis for file: {file_path}")
    print(f"[Task {self.request.id}] Preprocessing options: {preprocessing_options}")

    try:
        # Generate sample multi-channel data for now (replace with actual DDA implementation)
        n_channels = 256
        n_samples = 10000
        data = np.random.randn(n_channels, n_samples)  # Multi-channel data
        sampling_rate = 1000.0  # Replace with actual sampling rate from file
        print(f"[Task {self.request.id}] Generated sample data with shape {data.shape}")

        if preprocessing_options:
            print(f"[Task {self.request.id}] Applying preprocessing...")
            # Preprocess each channel
            for i in range(n_channels):
                data[i] = preprocess_data(data[i], sampling_rate, preprocessing_options)
            print(f"[Task {self.request.id}] Preprocessing complete")

        # Compute mean across channels for DDA analysis
        mean_data = data.mean(axis=0)
        print(f"[Task {self.request.id}] Computed mean across channels")

        # Simulate DDA peaks on the mean signal (replace with actual DDA algorithm)
        peaks = np.zeros_like(mean_data)
        for i in range(
            50, len(mean_data), 100
        ):  # Add synthetic peaks every 100 samples
            peaks[i] = 1.0
        print(f"[Task {self.request.id}] Generated peaks array with {sum(peaks)} peaks")

        result = {
            "file_path": file_path,
            "results": {
                "data": mean_data.tolist(),  # Return mean signal for visualization
                "peaks": peaks.tolist(),  # Return peaks for visualization
            },
            "preprocessing": preprocessing_options,
        }
        print(f"[Task {self.request.id}] Task completed successfully")
        return result
    except Exception as e:
        print(f"[Task {self.request.id}] Error during task execution: {e}")
        self.update_state(state="FAILURE", meta={"error": str(e)})
        raise


@celery_app.task(name="server.tasks.dda.cleanup_task")
def cleanup_task(task_id: str) -> None:
    """Clean up resources after a task completes.

    Args:
        task_id: Task ID to clean up
    """
    # TODO: Implement cleanup
    pass
