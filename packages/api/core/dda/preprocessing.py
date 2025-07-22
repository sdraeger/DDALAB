from typing import Optional

import numpy as np
from scipy import signal


def preprocess_data(
    data: np.ndarray, sampling_rate: float, options: Optional[dict] = None
) -> np.ndarray:
    """Preprocess the data according to the specified options."""
    if not options:
        return data

    processed_data = data.copy()

    # Resampling
    if new_sampling_rate := options.get("resample"):
        new_length = int(len(data) * new_sampling_rate / sampling_rate)
        processed_data = signal.resample(processed_data, new_length)
        sampling_rate = new_sampling_rate

    # Filtering
    nyquist = sampling_rate / 2
    if options.get("lowpassFilter"):
        b, a = signal.butter(4, 40 / nyquist, btype="low")
        processed_data = signal.filtfilt(b, a, processed_data)

    if options.get("highpassFilter"):
        b, a = signal.butter(4, 0.5 / nyquist, btype="high")
        processed_data = signal.filtfilt(b, a, processed_data)

    if freq := options.get("notchFilter"):
        b, a = signal.iirnotch(freq, 30, sampling_rate)
        processed_data = signal.filtfilt(b, a, processed_data)

    if options.get("detrend"):
        processed_data = signal.detrend(processed_data)

    return processed_data
