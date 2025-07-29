from datetime import datetime
from typing import List

import numpy as np
from pyedflib import FILETYPE_EDF


class EDFFile:
    """Representation of an EDF file with signals."""

    def __init__(
        self,
        signals: List[np.ndarray] = [],
        labels: List[str] = [],
        sampling_frequencies: List[float] = [],
        start_datetime: datetime = datetime.now(),
        physical_maximum: List[float] = [],
        physical_minimum: List[float] = [],
        digital_maximum: List[float] = [],
        digital_minimum: List[float] = [],
        edf_type: int = FILETYPE_EDF,
    ):
        """Initialize an empty EDF file object."""
        self.signals = signals
        self.labels = labels
        self.sampling_frequencies = sampling_frequencies
        self.start_datetime = start_datetime
        self.physical_maximum = physical_maximum
        self.physical_minimum = physical_minimum
        self.digital_maximum = digital_maximum
        self.digital_minimum = digital_minimum
        self.edf_type = edf_type

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
