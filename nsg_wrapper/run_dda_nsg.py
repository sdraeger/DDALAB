#!/usr/bin/env python3
import os
import sys
import json
import subprocess
import urllib.request
from pathlib import Path
import struct

# Import local dda module (fixed version with customizable parameters)
import dda

# DDA binary URL (x86_64 binary compatible with Linux and macOS via Rosetta)
DDA_BINARY_URL = "https://snl.salk.edu/~sfdraeger/run_DDA_AsciiEdf"

def download_dda_binary():
    binary_url = DDA_BINARY_URL
    binary_name = "run_DDA_AsciiEdf"

    print(f"Downloading DDA binary from {binary_url}...")

    try:
        urllib.request.urlretrieve(binary_url, binary_name)

        # Make executable
        os.chmod(binary_name, 0o755)

        print(f"✅ Downloaded: {binary_name}")

        return Path(binary_name).absolute()
    except Exception as e:
        print(f"❌ Error downloading DDA binary: {e}", file=sys.stderr)
        sys.exit(1)

def parse_params():
    if not os.path.exists("params.json"):
        print("Error: params.json not found", file=sys.stderr)
        sys.exit(1)

    with open("params.json", "r") as f:
        params = json.load(f)

    return params

def build_custom_params(params):
    """Build custom DDA parameters from params.json to match dda-rs exactly."""

    # Generate TAU (delay) values - MUST match dda-rs implementation exactly
    # dda-rs uses: for delay in delay_min..=delay_max { command.arg(delay.to_string()); }
    # This is an INCLUSIVE range of ALL integers from min to max
    scale_min = params["scale_min"]
    scale_max = params["scale_max"]

    # Generate ALL integer values from scale_min to scale_max (inclusive)
    # This matches the Rust implementation exactly
    tau_values = [str(delay) for delay in range(scale_min, scale_max + 1)]

    print(f"Generated TAU values: {tau_values} (inclusive range {scale_min} to {scale_max})")

    # Generate variant selection mask
    variants = params.get("variants", [])
    if not variants:
        print("⚠️  No variants specified, defaulting to single_timeseries only")
        variants = ["single_timeseries"]

    variant_order = ["single_timeseries", "cross_timeseries", "cross_dynamical", "dynamical_ergodicity"]
    select_mask = ["1" if v in variants else "0" for v in variant_order]

    print(f"Variant mask: -SELECT {' '.join(select_mask)} (enabled: {variants})")

    # Use exact window step from user parameters - no overrides
    window_step = params["window_step"]
    print(f"Window step: {window_step} (using exact user parameter)")

    # Build custom BASE_PARAMS - MUST match dda-rs exactly
    # dda-rs uses hardcoded nr_tau=2, not dynamic based on TAU count
    custom_params = {
        "-dm": "4",
        "-order": "4",
        "-nr_tau": "2",  # Hardcoded to match dda-rs (not len(tau_values))
        "-WL": str(params["window_length"]),
        "-WS": str(window_step),
        "-SELECT": select_mask,
        "-MODEL": ["1", "2", "10"],
        "-TAU": tau_values,
    }

    return custom_params

def read_edf_sample_rate(edf_path):
    """Read sample rate from EDF file header (minimal implementation, no external deps)."""
    try:
        with open(edf_path, 'rb') as f:
            # EDF header structure:
            # 0-7: version (8 bytes)
            # 8-87: patient ID (80 bytes)
            # 88-167: recording ID (80 bytes)
            # 168-175: start date (8 bytes)
            # 176-183: start time (8 bytes)
            # 184-191: header bytes (8 bytes)
            # 192-235: reserved (44 bytes)
            # 236-243: num data records (8 bytes)
            # 244-251: duration of data record in seconds (8 bytes)
            # 252-255: number of signals (4 bytes)

            # Read number of signals
            f.seek(252)
            ns_str = f.read(4).decode('ascii').strip()
            num_signals = int(ns_str)

            # Read duration of data record
            f.seek(244)
            duration_str = f.read(8).decode('ascii').strip()
            duration = float(duration_str)

            # Skip to signal-specific headers
            # Each signal has various fields, samples per data record is at offset:
            # 256 + num_signals * (16+80+8+8+8+8+80+8+32) = 256 + num_signals * 216
            # Then samples_per_record for each signal: num_signals * 8 bytes

            samples_offset = 256 + num_signals * 216
            f.seek(samples_offset)

            # Read samples per data record for first signal
            samples_str = f.read(8).decode('ascii').strip()
            samples_per_record = int(samples_str)

            # Sample rate = samples per record / duration of record
            sample_rate = samples_per_record / duration if duration > 0 else 0

            print(f"EDF header: {num_signals} signals, {samples_per_record} samples/record, {duration}s/record")
            print(f"Calculated sample rate: {sample_rate} Hz")

            return sample_rate

    except Exception as e:
        print(f"⚠️  Warning: Could not read EDF sample rate: {e}")
        print("   Will not apply time bounds")
        return None

def read_edf_channel_names(edf_path):
    """Read channel names from EDF file header."""
    try:
        with open(edf_path, 'rb') as f:
            # Read number of signals
            f.seek(252)
            ns_str = f.read(4).decode('ascii').strip()
            num_signals = int(ns_str)

            # After fixed header (256 bytes), signal-specific headers begin
            # Each signal has:
            # - Label (16 bytes)
            # - Transducer type (80 bytes)
            # - Physical dimension (8 bytes)
            # - Physical minimum (8 bytes)
            # - Physical maximum (8 bytes)
            # - Digital minimum (8 bytes)
            # - Digital maximum (8 bytes)
            # - Prefiltering (80 bytes)
            # - Samples per data record (8 bytes)
            # - Reserved (32 bytes)
            # Total: 256 bytes per signal field type

            # Channel labels start at offset 256
            f.seek(256)
            channel_names = []
            for i in range(num_signals):
                label_bytes = f.read(16)
                label = label_bytes.decode('ascii', errors='ignore').strip()
                channel_names.append(label if label else f"Ch{i+1}")

            print(f"📝 Read {len(channel_names)} channel names from EDF: {channel_names[:5]}{'...' if len(channel_names) > 5 else ''}")
            return channel_names

    except Exception as e:
        print(f"⚠️  Warning: Could not read EDF channel names: {e}")
        return None

def calculate_bounds(params, sample_rate):
    """Calculate sample index bounds from time range and sample rate."""
    time_start = params.get("time_start")
    time_end = params.get("time_end")

    if time_start is None or time_end is None:
        print("No time bounds specified")
        return None

    if sample_rate is None or sample_rate <= 0:
        print("⚠️  Cannot calculate bounds without valid sample rate")
        return None

    # Convert seconds to sample indices
    start_sample = int(time_start * sample_rate)
    end_sample = int(time_end * sample_rate)

    print(f"Time range: {time_start}s - {time_end}s")
    print(f"Sample indices: {start_sample} - {end_sample} (at {sample_rate} Hz)")

    return (start_sample, end_sample)

def save_results_json(Q, output_path, params, channel_names=None):
    """Save processed results as JSON."""
    import numpy as np

    result_json = {
        "q_matrix": Q.tolist(),
        "shape": list(Q.shape),
        "num_channels": Q.shape[0],
        "num_timepoints": Q.shape[1] if len(Q.shape) > 1 else 1,
        "channel_names": channel_names,  # Include actual channel names from EDF
        "parameters": {
            "input_file": params["input_file"],
            "channels": params.get("channels", []),
            "time_range": {
                "start": params.get("time_start"),
                "end": params.get("time_end")
            },
            "window_length": params["window_length"],
            "window_step": params["window_step"],
            "scale_min": params["scale_min"],
            "scale_max": params["scale_max"],
            "scale_num": params["scale_num"],
            "variants": params.get("variants", [])
        }
    }

    json_path = Path("dda_results.json")
    with open(json_path, 'w') as f:
        json.dump(result_json, f, indent=2)

    print(f"✅ Saved processed results to: {json_path}")
    print(f"   Matrix shape: {Q.shape[0]} channels × {Q.shape[1] if len(Q.shape) > 1 else 1} timepoints")

    return json_path

def main():
    print("=" * 80)
    print("DDA NSG Wrapper Script")
    print("=" * 80)

    print("\n[1/4] Downloading DDA binary...")
    binary_path = download_dda_binary()

    print("\n[2/4] Parsing parameters...")
    params = parse_params()
    print(f"Input file: {params['input_file']}")
    print(f"Time range: {params.get('time_start')} - {params.get('time_end')}")
    print(f"Window: {params['window_length']} (step: {params['window_step']})")
    print(f"Scale range: {params['scale_min']}-{params['scale_max']} ({params['scale_num']} steps)")
    print(f"Channels: {params.get('channels', [])}")
    print(f"Variants: {params.get('variants', ['single_timeseries'])}")

    print("\n[3/4] Building custom DDA parameters...")
    custom_params = build_custom_params(params)

    print("\n[4/4] Running DDA analysis with user's exact parameters...")
    print("-" * 80)

    try:
        # Create DDA runner with custom parameters
        runner = dda.DDARunner(str(binary_path), base_params=custom_params)

        # Convert channels to list of ints and convert to 1-based indexing
        # (DDA binary expects 1-based channel numbers, frontend sends 0-based)
        channel_list = [int(c) + 1 for c in params.get("channels", [])]

        # Debug: Check if input file exists
        import os
        import shutil
        if os.path.exists(params['input_file']):
            file_size = os.path.getsize(params['input_file'])
            print(f"\n✅ Input file exists: {params['input_file']} ({file_size:,} bytes)")
        else:
            print(f"\n❌ ERROR: Input file not found: {params['input_file']}")
            print(f"Working directory: {os.getcwd()}")
            print(f"Files in directory: {os.listdir('.')}")
            raise FileNotFoundError(f"Input file not found: {params['input_file']}")

        # WORKAROUND: Copy file to simple name without spaces
        # Some binaries don't handle filenames with spaces/parentheses well
        original_filename = params['input_file']
        simple_filename = "input_data.edf"

        if original_filename != simple_filename:
            print(f"\n📝 Copying file to simple name: {original_filename} → {simple_filename}")
            shutil.copy2(original_filename, simple_filename)
            input_file_to_use = simple_filename
        else:
            input_file_to_use = original_filename

        # Read EDF sample rate and calculate time bounds to match local dda-rs behavior
        print(f"\n📊 Reading EDF header to get sample rate and channel names...")
        sample_rate = read_edf_sample_rate(input_file_to_use)
        bounds = calculate_bounds(params, sample_rate) if sample_rate else None

        # Read channel names from EDF
        all_channel_names = read_edf_channel_names(input_file_to_use)

        # Map the selected channel indices to their names
        selected_channel_indices = params.get("channels", [])
        selected_channel_names = None
        if all_channel_names and selected_channel_indices:
            selected_channel_names = [
                all_channel_names[int(idx)] if int(idx) < len(all_channel_names) else f"Ch{int(idx)+1}"
                for idx in selected_channel_indices
            ]
            print(f"📝 Selected channel names: {selected_channel_names}")

        print(f"\n📊 Analysis parameters:")
        print(f"  - Input: {params['input_file']}")
        print(f"  - Channels (0-based from frontend): {[int(c) for c in params.get('channels', [])]}")
        print(f"  - Channels (1-based for DDA binary): {channel_list}")
        print(f"  - Bounds: {bounds}")
        print(f"  - Window: {params['window_length']} (step: {params['window_step']})")
        print(f"  - TAU values: {custom_params['-TAU']}")
        print(f"  - SELECT mask: {custom_params['-SELECT']}")

        # Run DDA analysis with user's exact parameters - no fallbacks
        Q, output_path = runner.run(
            input_file=input_file_to_use,
            output_file="dda_output",
            channel_list=channel_list,
            bounds=bounds,
            raise_on_error=True
        )

        print("-" * 80)
        print(f"\n✅ DDA analysis completed successfully!")
        print(f"Result shape: {Q.shape}")
        print(f"Raw output saved to: {output_path}")

        # Save as JSON with channel names
        json_path = save_results_json(Q, output_path, params, selected_channel_names)
        file_size = os.path.getsize(json_path)
        print(f"Result file size: {file_size} bytes")

        return 0

    except subprocess.CalledProcessError as e:
        print(f"\n❌ Error: DDA analysis failed with exit code {e.returncode}", file=sys.stderr)
        if e.output:
            print(f"STDOUT: {e.output}", file=sys.stderr)
        if e.stderr:
            print(f"STDERR: {e.stderr}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"❌ Unexpected error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
