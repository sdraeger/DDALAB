#!/usr/bin/env python3
"""MNE-Python Bridge for DDALAB.

Standalone script invoked via subprocess. Reads JSON request from stdin,
writes JSON response to stdout. Supports two modes:
  - metadata_only: Returns file metadata + channel types/units
  - read_data: Reads data, writes binary float64 to temp file, returns path + metadata
"""
import json
import sys
import os
import tempfile
import struct

try:
    import mne

    mne.set_log_level("ERROR")
    MNE_AVAILABLE = True
    MNE_VERSION = mne.__version__
except ImportError:
    MNE_AVAILABLE = False
    MNE_VERSION = None

try:
    import numpy as np
except ImportError:
    np = None


def respond(data):
    json.dump(data, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()


def respond_error(message):
    respond({"status": "error", "error": message})


def get_channel_type_name(raw, ch_name):
    """Get the MNE channel type as a DDALAB-compatible string."""
    ch_type = mne.io.pick.channel_type(raw.info, raw.ch_names.index(ch_name))
    type_map = {
        "eeg": "EEG",
        "meg": "MEG",
        "mag": "MEG",
        "grad": "MEG",
        "eog": "EOG",
        "ecg": "ECG",
        "emg": "EMG",
        "stim": "STIM",
        "resp": "RESP",
        "misc": "MISC",
        "ref_meg": "MEG",
        "ias": "MISC",
        "syst": "MISC",
        "seeg": "EEG",
        "ecog": "EEG",
        "dbs": "EEG",
        "bio": "MISC",
        "fnirs_cw_amplitude": "MISC",
        "fnirs_od": "MISC",
        "hbo": "MISC",
        "hbr": "MISC",
    }
    return type_map.get(ch_type, "Unknown")


def get_channel_unit(raw, ch_name):
    """Get the physical unit string for a channel."""
    idx = raw.ch_names.index(ch_name)
    ch_info = raw.info["chs"][idx]
    # FIFF unit codes
    unit_code = ch_info.get("unit", 0)
    unit_mul = ch_info.get("unit_mul", 0)
    unit_map = {
        107: "V",   # FIFF_UNIT_V
        112: "T",   # FIFF_UNIT_T
        201: "Am",  # FIFF_UNIT_AM
    }
    prefix_map = {
        0: "",
        -3: "m",
        -6: "u",
        -9: "n",
        -12: "p",
        -15: "f",
        3: "k",
        6: "M",
    }
    base = unit_map.get(unit_code, "")
    prefix = prefix_map.get(unit_mul, "")
    if base:
        return f"{prefix}{base}"
    return "uV"


def handle_metadata_only(request):
    """Read file metadata without loading data."""
    file_path = request.get("file_path")
    if not file_path or not os.path.exists(file_path):
        return respond_error(f"File not found: {file_path}")

    try:
        raw = mne.io.read_raw(file_path, preload=False, verbose=False)
    except Exception as e:
        return respond_error(f"Failed to open file: {e}")

    ch_names = raw.ch_names
    ch_types = [get_channel_type_name(raw, ch) for ch in ch_names]
    ch_units = [get_channel_unit(raw, ch) for ch in ch_names]
    n_samples = raw.n_times
    sfreq = raw.info["sfreq"]
    duration = n_samples / sfreq if sfreq > 0 else 0.0

    # Get start time
    start_time = None
    meas_date = raw.info.get("meas_date")
    if meas_date is not None:
        try:
            start_time = meas_date.isoformat()
        except Exception:
            pass

    respond({
        "status": "ok",
        "metadata": {
            "file_path": file_path,
            "file_name": os.path.basename(file_path),
            "sample_rate": sfreq,
            "num_channels": len(ch_names),
            "num_samples": n_samples,
            "duration": duration,
            "channels": ch_names,
            "channel_types": ch_types,
            "channel_units": ch_units,
            "start_time": start_time,
        },
    })


def handle_read_data(request):
    """Read file data and write binary to temp file."""
    file_path = request.get("file_path")
    start_sample = request.get("start_sample", 0)
    num_samples = request.get("num_samples")
    channels = request.get("channels")  # Optional list of channel names

    if not file_path or not os.path.exists(file_path):
        return respond_error(f"File not found: {file_path}")

    if np is None:
        return respond_error("numpy is required but not installed")

    try:
        raw = mne.io.read_raw(file_path, preload=False, verbose=False)
    except Exception as e:
        return respond_error(f"Failed to open file: {e}")

    # Resolve channel selection
    if channels:
        picks = mne.pick_channels(raw.ch_names, include=channels, ordered=True)
    else:
        picks = None

    # Resolve sample range
    stop_sample = None
    if num_samples is not None:
        stop_sample = min(start_sample + num_samples, raw.n_times)

    try:
        data, _ = raw.get_data(
            picks=picks,
            start=start_sample,
            stop=stop_sample,
            return_times=True,
        )
    except Exception as e:
        return respond_error(f"Failed to read data: {e}")

    # Write binary float64 data to temp file (channels x samples, C-contiguous)
    tmp = tempfile.NamedTemporaryFile(
        suffix=".bin", prefix="ddalab_mne_", delete=False
    )
    try:
        data.astype(np.float64).tofile(tmp)
        tmp.close()
    except Exception as e:
        tmp.close()
        os.unlink(tmp.name)
        return respond_error(f"Failed to write data: {e}")

    n_channels, n_samples_out = data.shape
    ch_names = [raw.ch_names[i] for i in (picks if picks is not None else range(len(raw.ch_names)))]

    respond({
        "status": "ok",
        "data_file": tmp.name,
        "num_channels": n_channels,
        "num_samples": n_samples_out,
        "channels": ch_names,
        "sample_rate": raw.info["sfreq"],
    })


def main():
    if not MNE_AVAILABLE:
        respond_error("MNE-Python not installed")
        sys.exit(1)

    # Read request from stdin
    try:
        line = sys.stdin.readline()
        if not line.strip():
            respond_error("Empty request")
            sys.exit(1)
        request = json.loads(line)
    except json.JSONDecodeError as e:
        respond_error(f"Invalid JSON: {e}")
        sys.exit(1)

    mode = request.get("mode", "")

    if mode == "metadata_only":
        handle_metadata_only(request)
    elif mode == "read_data":
        handle_read_data(request)
    elif mode == "check":
        respond({
            "status": "ok",
            "mne_version": MNE_VERSION,
            "has_mne": True,
        })
    else:
        respond_error(f"Unknown mode: {mode}")


if __name__ == "__main__":
    main()
