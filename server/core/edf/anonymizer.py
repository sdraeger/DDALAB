"""EDF file anonymization utilities."""

import os
import re
from datetime import datetime
from typing import Dict, Optional

import pyedflib
from loguru import logger


def anonymize_edf_file(file_path: str, output_path: Optional[str] = None) -> str:
    """Anonymize an EDF file by removing/modifying identifying information.

    Args:
        file_path: Path to the original EDF file
        output_path: Optional path for the anonymized file. If not provided,
                    will create one based on the original filename

    Returns:
        Path to the anonymized file
    """
    try:
        # Generate anonymized filename if not provided
        if not output_path:
            dir_path = os.path.dirname(file_path)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            anon_filename = f"anon_{timestamp}_{os.urandom(4).hex()}.edf"
            output_path = os.path.join(dir_path, anon_filename)

        # Open original file and create new anonymized file
        with pyedflib.EdfReader(file_path) as f_in:
            n_channels = f_in.signals_in_file
            signal_headers = f_in.getSignalHeaders()

            # Anonymize headers
            header = f_in.getHeader()
            anon_header = anonymize_header(header)

            # Prepare anonymized signal info
            signals_data = []
            signal_headers_clean = []

            # Read all signals
            for i in range(n_channels):
                signals_data.append(f_in.readSignal(i))
                header = signal_headers[i].copy()
                # Remove any identifying information from signal labels
                header["label"] = anonymize_signal_label(header["label"])
                signal_headers_clean.append(header)

            # Write anonymized file
            with pyedflib.EdfWriter(
                output_path, n_channels=n_channels, file_type=pyedflib.FILETYPE_EDFPLUS
            ) as f_out:
                f_out.setHeader(anon_header)
                f_out.setSignalHeaders(signal_headers_clean)
                for i, signal in enumerate(signals_data):
                    f_out.writePhysicalSamples(signal)

        logger.info(f"Successfully anonymized EDF file: {output_path}")
        return output_path

    except Exception as e:
        logger.error(f"Error anonymizing EDF file: {e}")
        raise


def anonymize_header(header: Dict) -> Dict:
    """Anonymize EDF header information.

    Args:
        header: Original EDF header dictionary

    Returns:
        Anonymized header dictionary
    """
    anon_header = header.copy()

    # Remove/modify identifying information
    anon_header["patientname"] = "X" * len(header.get("patientname", ""))
    anon_header["patient_additional"] = ""
    anon_header["admincode"] = ""
    anon_header["technician"] = ""
    anon_header["equipment"] = "ANONYMIZED_EQUIPMENT"
    anon_header["recording_additional"] = ""

    return anon_header


def anonymize_signal_label(label: str) -> str:
    """Anonymize a signal label by removing potential identifying information.

    Args:
        label: Original signal label

    Returns:
        Anonymized signal label
    """
    # Remove any patient-specific identifiers that might be in the label
    # Keep only the signal type (EEG, ECG, etc.)
    clean_label = re.sub(r"[^A-Za-z]", "", label)
    return clean_label or "Signal"
