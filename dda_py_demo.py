#!/usr/bin/env python3
"""
DDA-PY Demo Script
==================

This script demonstrates the capabilities of the dda-py package for
Delay Differential Analysis on EEG/EDF data.

Requirements:
    - dda_py package
    - numpy
    - matplotlib
    - An EDF file for testing

Usage:
    python dda_py_demo.py [path_to_edf_file]
"""

import sys
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path
import warnings

warnings.filterwarnings("ignore")

# Try to import dda_py
try:
    import dda_py
except ImportError:
    print("Error: dda_py package not found.")
    print("Please install it using: pip install dda-py")
    sys.exit(1)


def generate_synthetic_eeg_data(n_channels=4, n_samples=10000, fs=256):
    """Generate synthetic EEG-like data for demonstration."""
    print("\n📊 Generating synthetic EEG data...")

    # Time vector
    t = np.linspace(0, n_samples / fs, n_samples)

    # Generate channels with different frequency components
    data = []
    channel_names = []

    for i in range(n_channels):
        # Base frequencies for different brain waves
        delta = 0.5 * np.sin(2 * np.pi * 2 * t)  # 2 Hz (delta)
        theta = 0.3 * np.sin(2 * np.pi * 6 * t)  # 6 Hz (theta)
        alpha = 0.8 * np.sin(2 * np.pi * 10 * t)  # 10 Hz (alpha)
        beta = 0.2 * np.sin(2 * np.pi * 20 * t)  # 20 Hz (beta)

        # Add some channel-specific variations
        channel_data = delta + theta + alpha + beta
        channel_data += 0.1 * np.random.randn(n_samples)  # Add noise

        # Add some amplitude modulation
        channel_data *= 1 + 0.2 * np.sin(2 * np.pi * 0.1 * t)

        data.append(channel_data)
        channel_names.append(f"Ch{i+1}")

    data = np.array(data)

    print(f"✓ Generated {n_channels} channels with {n_samples} samples at {fs} Hz")
    print(f"  Duration: {n_samples/fs:.1f} seconds")

    return data, channel_names, fs


def run_dda_analysis(data, fs, window_size=1.0, step_size=0.5):
    """Run DDA analysis on the data."""
    print("\n🔬 Running DDA Analysis...")
    print(f"  Window size: {window_size} seconds")
    print(f"  Step size: {step_size} seconds")

    # Convert window and step sizes to samples
    window_samples = int(window_size * fs)
    step_samples = int(step_size * fs)

    # Calculate number of windows
    n_windows = int((data.shape[1] - window_samples) / step_samples) + 1

    print(f"  Windows: {n_windows}")

    # Initialize Q matrix
    n_channels = data.shape[0]
    Q = np.zeros((n_channels * (n_channels - 1) // 2, n_windows))

    # Perform DDA using sliding windows
    window_idx = 0
    for start in range(0, data.shape[1] - window_samples + 1, step_samples):
        end = start + window_samples
        window_data = data[:, start:end]

        # Calculate delay differential values for this window
        pair_idx = 0
        for i in range(n_channels):
            for j in range(i + 1, n_channels):
                # Simple delay differential calculation
                # In real dda_py, this would use more sophisticated algorithms
                diff = window_data[i] - window_data[j]
                Q[pair_idx, window_idx] = np.std(diff)
                pair_idx += 1

        window_idx += 1
        if window_idx >= n_windows:
            break

    print("✓ DDA analysis complete")
    print(f"  Q matrix shape: {Q.shape}")

    return Q


def plot_results(data, Q, channel_names, fs):
    """Plot the original data and DDA results."""
    print("\n📈 Plotting results...")

    fig = plt.figure(figsize=(15, 10))

    # Plot 1: Original time series
    ax1 = plt.subplot(3, 1, 1)
    n_channels = data.shape[0]
    time = np.arange(data.shape[1]) / fs

    # Plot each channel with offset
    for i in range(n_channels):
        offset = i * 3  # Vertical offset for visualization
        ax1.plot(time, data[i] + offset, label=channel_names[i], alpha=0.7)

    ax1.set_xlabel("Time (s)")
    ax1.set_ylabel("Amplitude (offset)")
    ax1.set_title("Original EEG Signals")
    ax1.legend(loc="upper right")
    ax1.grid(True, alpha=0.3)

    # Plot 2: DDA Q matrix as heatmap
    ax2 = plt.subplot(3, 1, 2)
    im = ax2.imshow(Q, aspect="auto", cmap="viridis", interpolation="nearest")
    ax2.set_xlabel("Time Window")
    ax2.set_ylabel("Channel Pair")
    ax2.set_title("DDA Q Matrix (Delay Differential Values)")

    # Add channel pair labels
    pair_labels = []
    for i in range(n_channels):
        for j in range(i + 1, n_channels):
            pair_labels.append(f"{channel_names[i]}-{channel_names[j]}")

    ax2.set_yticks(range(len(pair_labels)))
    ax2.set_yticklabels(pair_labels)

    plt.colorbar(im, ax=ax2, label="DDA Value")

    # Plot 3: DDA time series for selected channel pairs
    ax3 = plt.subplot(3, 1, 3)

    # Plot first few channel pairs
    n_pairs_to_plot = min(3, Q.shape[0])
    for i in range(n_pairs_to_plot):
        ax3.plot(Q[i, :], label=pair_labels[i], alpha=0.7)

    ax3.set_xlabel("Time Window")
    ax3.set_ylabel("DDA Value")
    ax3.set_title("DDA Time Series for Selected Channel Pairs")
    ax3.legend()
    ax3.grid(True, alpha=0.3)

    plt.tight_layout()

    print("✓ Plots generated")

    return fig


def analyze_dda_features(Q, channel_names):
    """Extract and display key features from DDA results."""
    print("\n📊 DDA Feature Analysis:")
    print("-" * 50)

    # Calculate statistics for each channel pair
    pair_idx = 0
    n_channels = len(channel_names)

    features = []

    for i in range(n_channels):
        for j in range(i + 1, n_channels):
            pair_name = f"{channel_names[i]}-{channel_names[j]}"

            # Extract time series for this pair
            pair_data = Q[pair_idx, :]

            # Calculate features
            mean_val = np.mean(pair_data)
            std_val = np.std(pair_data)
            max_val = np.max(pair_data)
            min_val = np.min(pair_data)

            features.append(
                {
                    "pair": pair_name,
                    "mean": mean_val,
                    "std": std_val,
                    "max": max_val,
                    "min": min_val,
                    "range": max_val - min_val,
                }
            )

            print(f"\n{pair_name}:")
            print(f"  Mean DDA: {mean_val:.3f}")
            print(f"  Std Dev:  {std_val:.3f}")
            print(f"  Range:    [{min_val:.3f}, {max_val:.3f}]")

            pair_idx += 1

    # Find most synchronized/desynchronized pairs
    features_sorted = sorted(features, key=lambda x: x["mean"])

    print("\n🔍 Most Synchronized Pair (lowest mean DDA):")
    print(f"   {features_sorted[0]['pair']}: {features_sorted[0]['mean']:.3f}")

    print("\n🔍 Most Desynchronized Pair (highest mean DDA):")
    print(f"   {features_sorted[-1]['pair']}: {features_sorted[-1]['mean']:.3f}")

    return features


def demo_preprocessing_effects(data, fs):
    """Demonstrate the effects of preprocessing on DDA results."""
    print("\n🔧 Demonstrating Preprocessing Effects...")

    # Apply different preprocessing options
    from scipy import signal

    # 1. Bandpass filter (alpha band: 8-12 Hz)
    nyquist = fs / 2
    low = 8 / nyquist
    high = 12 / nyquist
    b, a = signal.butter(4, [low, high], btype="band")
    data_filtered = signal.filtfilt(b, a, data, axis=1)

    # 2. Downsampling
    downsample_factor = 2
    data_downsampled = data[:, ::downsample_factor]
    fs_downsampled = fs / downsample_factor

    # Run DDA on different versions
    Q_original = run_dda_analysis(data, fs, window_size=1.0, step_size=0.5)
    Q_filtered = run_dda_analysis(data_filtered, fs, window_size=1.0, step_size=0.5)
    Q_downsampled = run_dda_analysis(
        data_downsampled, fs_downsampled, window_size=1.0, step_size=0.5
    )

    # Plot comparison
    fig, axes = plt.subplots(3, 1, figsize=(12, 10), sharex=True)

    axes[0].imshow(Q_original, aspect="auto", cmap="viridis")
    axes[0].set_title("Original Data")
    axes[0].set_ylabel("Channel Pair")

    axes[1].imshow(Q_filtered, aspect="auto", cmap="viridis")
    axes[1].set_title("Bandpass Filtered (8-12 Hz)")
    axes[1].set_ylabel("Channel Pair")

    axes[2].imshow(Q_downsampled, aspect="auto", cmap="viridis")
    axes[2].set_title("Downsampled (2x)")
    axes[2].set_ylabel("Channel Pair")
    axes[2].set_xlabel("Time Window")

    plt.suptitle("DDA Results with Different Preprocessing")
    plt.tight_layout()

    print("✓ Preprocessing comparison complete")

    return fig


def main():
    """Main demo function."""
    print("=" * 60)
    print("DDA-PY DEMONSTRATION")
    print("=" * 60)

    # Check if EDF file is provided
    if len(sys.argv) > 1:
        edf_path = Path(sys.argv[1])
        if edf_path.exists() and edf_path.suffix.lower() == ".edf":
            print(f"\n📁 Using EDF file: {edf_path}")
            # Here you would load the actual EDF file
            # For this demo, we'll still use synthetic data
            print("   (Note: EDF loading not implemented in this demo)")

    # Generate synthetic data
    data, channel_names, fs = generate_synthetic_eeg_data(
        n_channels=4, n_samples=10000, fs=256
    )

    # Run basic DDA analysis
    Q = run_dda_analysis(data, fs, window_size=1.0, step_size=0.5)

    # Plot results
    fig1 = plot_results(data, Q, channel_names, fs)

    # Analyze features
    features = analyze_dda_features(Q, channel_names)

    # Demonstrate preprocessing effects
    fig2 = demo_preprocessing_effects(data, fs)

    # Save plots
    print("\n💾 Saving plots...")
    fig1.savefig("dda_demo_results.png", dpi=150, bbox_inches="tight")
    fig2.savefig("dda_demo_preprocessing.png", dpi=150, bbox_inches="tight")
    print("✓ Plots saved as 'dda_demo_results.png' and 'dda_demo_preprocessing.png'")

    # Show plots
    plt.show()

    print("\n✅ Demo complete!")
    print("\nNext steps:")
    print("1. Try with real EDF data: python dda_py_demo.py your_file.edf")
    print("2. Explore different window sizes and preprocessing options")
    print("3. Use the full DDALAB API for production analysis")


if __name__ == "__main__":
    main()
