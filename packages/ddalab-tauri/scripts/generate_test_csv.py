#!/usr/bin/env python3
"""
Generate test CSV files for LSL streaming

Creates synthetic EEG-like data in CSV format for testing.

Usage:
    python generate_test_csv.py output.csv --channels 8 --duration 10 --sfreq 250
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


def generate_eeg_like_data(n_channels, sfreq, duration):
    """Generate realistic EEG-like signals"""
    n_samples = int(sfreq * duration)
    t = np.arange(n_samples) / sfreq
    data = np.zeros((n_samples, n_channels))

    for ch in range(n_channels):
        # Different frequency components per channel
        # Alpha band (8-13 Hz)
        alpha_freq = 8 + (ch % 5)
        alpha_amp = 20 + 10 * np.random.rand()
        alpha = alpha_amp * np.sin(2 * np.pi * alpha_freq * t)

        # Beta band (13-30 Hz)
        beta_freq = 15 + (ch % 15)
        beta_amp = 10 + 5 * np.random.rand()
        beta = beta_amp * np.sin(2 * np.pi * beta_freq * t)

        # Theta band (4-8 Hz)
        theta_freq = 4 + (ch % 4)
        theta_amp = 15 + 5 * np.random.rand()
        theta = theta_amp * np.sin(2 * np.pi * theta_freq * t)

        # Background noise
        noise = 5 * np.random.randn(n_samples)

        # Combine signals
        data[:, ch] = alpha + beta + theta + noise

    return data


def main():
    parser = argparse.ArgumentParser(description="Generate test CSV for LSL streaming")

    parser.add_argument("output", type=str, help="Output CSV file path")

    parser.add_argument(
        "--channels", type=int, default=8, help="Number of channels (default: 8)"
    )

    parser.add_argument(
        "--duration", type=float, default=10.0, help="Duration in seconds (default: 10)"
    )

    parser.add_argument(
        "--sfreq", type=float, default=250.0, help="Sample rate in Hz (default: 250)"
    )

    args = parser.parse_args()

    # Generate data
    print(
        f"Generating {args.duration}s of {args.channels}-channel data at {args.sfreq} Hz..."
    )
    data = generate_eeg_like_data(args.channels, args.sfreq, args.duration)

    # Create DataFrame
    columns = [f"Ch{i + 1}" for i in range(args.channels)]
    df = pd.DataFrame(data, columns=columns)

    # Save to CSV
    output_path = Path(args.output)
    df.to_csv(output_path, index=False)

    print(f"Saved {len(df)} samples to {output_path}")
    print(f"  Channels: {args.channels}")
    print(f"  Sample rate: {args.sfreq} Hz")
    print(f"  Duration: {args.duration} s")
    print(f"  File size: {output_path.stat().st_size / 1024:.1f} KB")

    print(f"\nTo stream this file:")
    print(
        f"  python lsl_simple_streamer.py --csv {output_path} --channels {args.channels} --sfreq {args.sfreq} --loop"
    )


if __name__ == "__main__":
    main()
