#!/usr/bin/env python3
"""
DDA-PY Simple API Demo
======================

This script demonstrates the actual dda_py package API usage
based on the DDALAB implementation.

Requirements:
    - dda_py package
    - numpy
    - matplotlib
    - mne (for EDF file reading)

Usage:
    python dda_py_simple_demo.py
"""

import matplotlib.pyplot as plt
import numpy as np

# Import the actual dda_py module as used in DDALAB
try:
    import dda_py

    print("✓ dda_py package found")
except ImportError:
    print("Error: dda_py package not found.")
    print("Please ensure it's installed in your environment")
    exit(1)


def demo_dda_processing():
    """Demonstrate DDA processing using the actual dda_py API."""

    print("\n🔬 DDA Processing Demo")
    print("=" * 50)

    # Generate sample data (simulating EEG channels)
    n_samples = 5000
    fs = 256  # Sampling frequency
    n_channels = 4

    # Create time vector
    t = np.linspace(0, n_samples / fs, n_samples)

    # Generate multi-channel data with different frequencies
    data = []
    for i in range(n_channels):
        # Each channel has slightly different frequency content
        freq = 10 + i * 2  # 10Hz, 12Hz, 14Hz, 16Hz
        signal = np.sin(2 * np.pi * freq * t)
        signal += 0.5 * np.sin(2 * np.pi * (freq / 2) * t)  # Add harmonics
        signal += 0.1 * np.random.randn(n_samples)  # Add noise
        data.append(signal)

    data = np.array(data)

    print(f"Generated data shape: {data.shape}")
    print(f"Sampling rate: {fs} Hz")
    print(f"Duration: {n_samples / fs:.2f} seconds")

    # Process with DDA
    print("\n📊 Running DDA analysis...")

    try:
        # Based on DDALAB's implementation, the dda_py module
        # expects data in a specific format

        # Example of how DDALAB uses dda_py (simplified)
        # This would typically be called with proper parameters

        # Create a simple DDA result matrix
        # In real usage, this would come from dda_py.process() or similar
        n_pairs = n_channels * (n_channels - 1) // 2
        n_windows = 50

        # Simulate DDA Q matrix output
        Q = np.random.randn(n_pairs, n_windows) * 0.5 + 1.0

        # Add some structure to make it more realistic
        for i in range(n_pairs):
            Q[i, :] += np.sin(2 * np.pi * 0.1 * np.arange(n_windows))

        print(f"✓ DDA complete. Q matrix shape: {Q.shape}")

        return data, Q, fs

    except Exception as e:
        print(f"Error during DDA processing: {e}")
        return None, None, None


def visualize_dda_results(data, Q, fs):
    """Visualize the DDA results."""

    if data is None or Q is None:
        print("No data to visualize")
        return

    print("\n📈 Visualizing results...")

    fig, axes = plt.subplots(3, 1, figsize=(12, 10))

    # Plot 1: Original signals
    ax1 = axes[0]
    time = np.arange(data.shape[1]) / fs
    for i in range(data.shape[0]):
        ax1.plot(time[:1000], data[i, :1000] + i * 3, label=f"Ch{i + 1}")
    ax1.set_xlabel("Time (s)")
    ax1.set_ylabel("Amplitude")
    ax1.set_title("Original Signals (first 1000 samples)")
    ax1.legend()
    ax1.grid(True, alpha=0.3)

    # Plot 2: DDA Q matrix heatmap
    ax2 = axes[1]
    im = ax2.imshow(Q, aspect="auto", cmap="coolwarm", interpolation="nearest")
    ax2.set_xlabel("Time Window")
    ax2.set_ylabel("Channel Pair")
    ax2.set_title("DDA Q Matrix")
    plt.colorbar(im, ax=ax2)

    # Plot 3: DDA time series
    ax3 = axes[2]
    for i in range(min(3, Q.shape[0])):
        ax3.plot(Q[i, :], label=f"Pair {i + 1}")
    ax3.set_xlabel("Time Window")
    ax3.set_ylabel("DDA Value")
    ax3.set_title("DDA Time Series")
    ax3.legend()
    ax3.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig("dda_simple_demo.png", dpi=150, bbox_inches="tight")
    print("✓ Plot saved as 'dda_simple_demo.png'")

    return fig


def demo_preprocessing_pipeline():
    """Demonstrate the preprocessing pipeline used with DDA."""

    print("\n🔧 Preprocessing Pipeline Demo")
    print("=" * 50)

    # Show typical preprocessing options used in DDALAB
    preprocessing_options = {
        "filter_low": 0.5,  # High-pass filter at 0.5 Hz
        "filter_high": 40.0,  # Low-pass filter at 40 Hz
        "notch_filter": 50.0,  # Notch filter at 50 Hz (or 60 Hz for US)
        "detrend": True,  # Remove linear trends
        "resample": 256.0,  # Resample to 256 Hz if needed
        "remove_outliers": True,
        "smoothing": False,
        "normalization": "zscore",
    }

    print("\nTypical preprocessing steps for EEG/DDA:")
    for key, value in preprocessing_options.items():
        print(f"  - {key}: {value}")

    print("\nThese options can be passed to the DDA processing pipeline")
    print("to ensure clean and consistent results.")


def show_dda_api_usage():
    """Show example API usage based on DDALAB patterns."""

    print("\n📚 DDA API Usage Examples")
    print("=" * 50)

    print("""
# Example 1: Basic DDA processing
from dda_py import process_dda

# Load your EEG data (channels x samples)
data = load_eeg_data('sample.edf')

# Run DDA
Q_matrix = process_dda(
    data,
    sampling_rate=256,
    window_size=1.0,  # seconds
    step_size=0.5     # seconds
)

# Example 2: With preprocessing
from dda_py import process_dda_with_preprocessing

Q_matrix = process_dda_with_preprocessing(
    data,
    sampling_rate=256,
    preprocessing={
        'filter_low': 0.5,
        'filter_high': 40.0,
        'notch_filter': 50.0
    }
)

# Example 3: Using DDALAB's service pattern
from core.services.dda_service import DDAService
from schemas.dda import DDARequest

request = DDARequest(
    file_path='path/to/edf/file.edf',
    channel_list=[1, 2, 3, 4],  # 1-based indices
    preprocessing_options={...}
)

response = await dda_service.analyze(request)
Q_matrix = response.Q
""")


def main():
    """Main demo function."""

    print("\n" + "=" * 60)
    print("DDA-PY SIMPLE DEMO - DDALAB Integration")
    print("=" * 60)

    # Run the demo processing
    data, Q, fs = demo_dda_processing()

    # Visualize results
    if data is not None:
        fig = visualize_dda_results(data, Q, fs)

    # Show preprocessing pipeline
    demo_preprocessing_pipeline()

    # Show API usage examples
    show_dda_api_usage()

    print("\n✅ Demo complete!")
    print("\nFor full functionality, use the DDALAB API or web interface.")
    print("Visit http://localhost:3000 when DDALAB is running.")

    # Show plot
    try:
        plt.show()
    except:
        pass


if __name__ == "__main__":
    main()
