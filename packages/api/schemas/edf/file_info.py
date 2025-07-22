from typing import List

from pydantic import BaseModel


class EdfFileInfo(BaseModel):
    """Information about an EDF file."""

    file_path: str
    num_chunks: int
    chunk_size: int
    total_samples: int
    sampling_rate: float
    total_duration: float
    channels: List[str]  # List of channel names
