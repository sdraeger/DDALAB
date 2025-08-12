from datetime import datetime
from typing import List

import numpy as np
from pyedflib import FILETYPE_EDF


class EDFFile:
    """Representation of an EDF file with signals."""

    def __init__(
        self,
        signals: List[np.ndarray] | None = None,
        labels: List[str] | None = None,
        sampling_frequencies: List[float] | None = None,
        start_datetime: datetime | None = None,
        physical_maximum: List[float] | None = None,
        physical_minimum: List[float] | None = None,
        digital_maximum: List[float] | None = None,
        digital_minimum: List[float] | None = None,
        edf_type: int = FILETYPE_EDF,
    ):
        """Initialize an empty EDF file object."""
        # Avoid shared mutable defaults by constructing fresh lists/values
        self.signals = list(signals) if signals is not None else []
        self.labels = list(labels) if labels is not None else []
        self.sampling_frequencies = (
            list(sampling_frequencies) if sampling_frequencies is not None else []
        )
        self.start_datetime = start_datetime or datetime.now()
        self.physical_maximum = (
            list(physical_maximum) if physical_maximum is not None else []
        )
        self.physical_minimum = (
            list(physical_minimum) if physical_minimum is not None else []
        )
        self.digital_maximum = (
            list(digital_maximum) if digital_maximum is not None else []
        )
        self.digital_minimum = (
            list(digital_minimum) if digital_minimum is not None else []
        )
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
