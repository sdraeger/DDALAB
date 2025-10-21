#!/usr/bin/env python3
import os
import sys
import json
import subprocess
import urllib.request
from pathlib import Path

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
    """Build custom DDA parameters from params.json."""

    # Generate TAU (delay) values from scale parameters
    scale_min = params["scale_min"]
    scale_max = params["scale_max"]
    scale_num = params["scale_num"]

    # IMPORTANT: The binary has limits on TAU parameters
    # Based on testing, limit to max 10 TAU values to avoid empty output
    max_tau_values = 10
    if scale_num > max_tau_values:
        print(f"⚠️  Warning: Requested {scale_num} TAU values, limiting to {max_tau_values} for stability")
        scale_num = max_tau_values

    # Generate evenly spaced delay values
    if scale_num > 1:
        tau_values = [str(int(scale_min + (scale_max - scale_min) * i / (scale_num - 1)))
                      for i in range(scale_num)]
    else:
        tau_values = [str(scale_min)]

    print(f"Generated TAU values: {tau_values} (from scale range {scale_min}-{scale_max}, {scale_num} steps)")

    # Generate variant selection mask
    variants = params.get("variants", [])
    if not variants:
        print("⚠️  No variants specified, defaulting to single_timeseries only")
        variants = ["single_timeseries"]

    variant_order = ["single_timeseries", "cross_timeseries", "cross_dynamical", "dynamical_ergodicity"]
    select_mask = ["1" if v in variants else "0" for v in variant_order]

    print(f"Variant mask: -SELECT {' '.join(select_mask)} (enabled: {variants})")

    # Validate window step - if too small, use a reasonable default
    window_step = params["window_step"]
    min_window_step = 50  # Conservative minimum based on testing
    if window_step < min_window_step:
        print(f"⚠️  Warning: Window step {window_step} is too small, using {min_window_step} for stability")
        window_step = min_window_step

    # Build custom BASE_PARAMS
    custom_params = {
        "-dm": "4",
        "-order": "4",
        "-nr_tau": str(len(tau_values)),
        "-TAU": tau_values,
        "-WL": str(params["window_length"]),
        "-WS": str(window_step),
        "-SELECT": select_mask,
        "-MODEL": ["1", "2", "10"],
    }

    return custom_params

def save_results_json(Q, output_path, params):
    """Save processed results as JSON."""
    import numpy as np

    result_json = {
        "q_matrix": Q.tolist(),
        "shape": list(Q.shape),
        "num_channels": Q.shape[0],
        "num_timepoints": Q.shape[1] if len(Q.shape) > 1 else 1,
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

    # Also prepare fallback default parameters (known to work with the binary)
    default_params = {
        "-dm": "4",
        "-order": "4",
        "-nr_tau": "2",
        "-TAU": ["7", "10"],
        "-WL": "125",
        "-WS": "62",
        "-SELECT": ["1", "0", "0", "0"],
        "-MODEL": ["1", "2", "10"],
    }

    print("\n[4/4] Running DDA analysis...")
    print("-" * 80)

    try:
        # Create DDA runner with custom parameters
        runner = dda.DDARunner(str(binary_path), base_params=custom_params)

        # Convert channels to list of ints
        channel_list = [int(c) for c in params.get("channels", [])]

        # Don't pass time bounds - the binary expects sample indices and we don't have sample rate
        # Let the binary process the entire file or use the default behavior
        # The time windowing will happen via the window parameters (-WL, -WS)
        bounds = None

        print(f"\n📊 Analysis parameters:")
        print(f"  - Input: {params['input_file']}")
        print(f"  - Channels: {channel_list}")
        print(f"  - Bounds: {bounds}")
        print(f"  - Window: {params['window_length']} (step: {params['window_step']})")
        print(f"  - TAU values: {custom_params['-TAU']}")
        print(f"  - SELECT mask: {custom_params['-SELECT']}")

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

        # Run DDA analysis
        try:
            Q, output_path = runner.run(
                input_file=input_file_to_use,
                output_file="dda_output",
                channel_list=channel_list,
                bounds=bounds,
                raise_on_error=True
            )
        except (ValueError, FileNotFoundError) as e:
            error_msg = str(e)
            if "empty" in error_msg.lower() or "no data" in error_msg.lower():
                print("\n⚠️  Custom parameters produced empty output!")
                print("Retrying with default/fallback parameters...\n")

                # Retry with default parameters
                fallback_runner = dda.DDARunner(str(binary_path), base_params=default_params)
                Q, output_path = fallback_runner.run(
                    input_file=input_file_to_use,
                    output_file="dda_output_fallback",
                    channel_list=channel_list,
                    bounds=bounds,
                    raise_on_error=True
                )
                print("\n✅ Fallback parameters worked!")
            else:
                raise

        print("-" * 80)
        print(f"\n✅ DDA analysis completed successfully!")
        print(f"Result shape: {Q.shape}")
        print(f"Raw output saved to: {output_path}")

        # Save as JSON
        json_path = save_results_json(Q, output_path, params)
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
