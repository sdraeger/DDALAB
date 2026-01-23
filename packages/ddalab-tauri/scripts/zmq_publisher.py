#!/usr/bin/env python3
"""
ZeroMQ Publisher for DDALAB Streaming

Publishes synthetic or file-based EEG data via ZeroMQ PUB socket.
Compatible with DDALAB's ZMQ SUB streaming source.

Install dependencies:
    pip install pyzmq numpy mne

Usage:
    # Publish synthetic EEG-like data
    python zmq_publisher.py --synthetic --channels 8 --sfreq 250

    # Publish from EDF file
    python zmq_publisher.py --edf data.edf --loop

    # Custom endpoint
    python zmq_publisher.py --synthetic --endpoint tcp://*:5556
"""

import argparse
import json
import time

import numpy as np
import zmq


def generate_synthetic_chunk(num_channels, chunk_size, sample_rate, sequence):
    """Generate synthetic EEG-like data"""
    # Create realistic EEG-like signals with different frequency bands
    t = np.arange(chunk_size) / sample_rate
    samples = []

    for ch in range(num_channels):
        # Mix of alpha (8-12 Hz), beta (13-30 Hz), and noise
        alpha = 10 * np.sin(2 * np.pi * (8 + ch * 0.5) * t)
        beta = 5 * np.sin(2 * np.pi * (15 + ch * 0.3) * t)
        noise = np.random.randn(chunk_size) * 2
        signal = alpha + beta + noise
        samples.append(signal.tolist())

    return {
        "samples": samples,
        "timestamp": time.time(),
        "sample_rate": float(sample_rate),
        "channel_names": [f"Ch{i + 1}" for i in range(num_channels)],
        "sequence": sequence,
    }


def publish_synthetic(endpoint, channels, sfreq, chunk_size, topic=""):
    """Publish synthetic data continuously"""
    context = zmq.Context()
    socket = context.socket(zmq.PUB)
    socket.bind(endpoint)

    print(f"📡 Publishing synthetic EEG data on {endpoint}")
    print(f"   Channels: {channels}, Sample rate: {sfreq} Hz")
    print(f"   Chunk size: {chunk_size} samples")
    if topic:
        print(f"   Topic: '{topic}'")
    print("\nPress Ctrl+C to stop\n")

    # Give subscribers time to connect
    time.sleep(0.5)

    sequence = 0
    chunk_interval = chunk_size / sfreq  # Time between chunks

    try:
        while True:
            start_time = time.time()

            # Generate and send chunk
            chunk = generate_synthetic_chunk(channels, chunk_size, sfreq, sequence)
            message = json.dumps(chunk).encode("utf-8")

            if topic:
                socket.send_multipart([topic.encode("utf-8"), message])
            else:
                socket.send(message)

            sequence += 1

            if sequence % 10 == 0:
                print(f"📊 Sent {sequence} chunks ({sequence * chunk_size} samples)")

            # Sleep to maintain target rate
            elapsed = time.time() - start_time
            sleep_time = max(0, chunk_interval - elapsed)
            time.sleep(sleep_time)

    except KeyboardInterrupt:
        print(f"\n✅ Published {sequence} chunks total")
    finally:
        socket.close()
        context.term()


def publish_from_edf(endpoint, edf_path, chunk_size, loop, topic=""):
    """Publish data from EDF file"""
    try:
        import mne
    except ImportError:
        print("❌ Error: mne package required for EDF files")
        print("   Install with: pip install mne")
        return

    context = zmq.Context()
    socket = context.socket(zmq.PUB)
    socket.bind(endpoint)

    print(f"📡 Publishing EDF data on {endpoint}")
    print(f"   File: {edf_path}")
    print(f"   Chunk size: {chunk_size} samples")
    if topic:
        print(f"   Topic: '{topic}'")
    print(f"   Loop: {loop}")
    print("\nLoading EDF file...")

    # Load EDF
    raw = mne.io.read_raw_edf(edf_path, preload=True, verbose=False)
    data = raw.get_data()  # [channels, samples]
    sfreq = raw.info["sfreq"]
    channel_names = raw.ch_names

    num_channels, total_samples = data.shape
    print(f"   Channels: {num_channels}, Samples: {total_samples}")
    print(f"   Sample rate: {sfreq} Hz")
    print("\nPress Ctrl+C to stop\n")

    # Give subscribers time to connect
    time.sleep(0.5)

    sequence = 0
    chunk_interval = chunk_size / sfreq

    try:
        while True:
            start_idx = 0

            while start_idx < total_samples:
                start_time = time.time()

                # Get chunk
                end_idx = min(start_idx + chunk_size, total_samples)
                chunk_data = data[:, start_idx:end_idx]

                # Convert to list format (channels x samples)
                samples = [chunk_data[ch].tolist() for ch in range(num_channels)]

                chunk = {
                    "samples": samples,
                    "timestamp": time.time(),
                    "sample_rate": float(sfreq),
                    "channel_names": channel_names,
                    "sequence": sequence,
                }

                message = json.dumps(chunk).encode("utf-8")

                if topic:
                    socket.send_multipart([topic.encode("utf-8"), message])
                else:
                    socket.send(message)

                sequence += 1
                start_idx = end_idx

                if sequence % 10 == 0:
                    progress = (start_idx / total_samples) * 100
                    print(f"📊 Sent {sequence} chunks ({progress:.1f}% of file)")

                # Sleep to maintain target rate
                elapsed = time.time() - start_time
                sleep_time = max(0, chunk_interval - elapsed)
                time.sleep(sleep_time)

            if not loop:
                break

            print("🔄 Looping file...")

    except KeyboardInterrupt:
        print(f"\n✅ Published {sequence} chunks total")
    finally:
        socket.close()
        context.term()


def main():
    parser = argparse.ArgumentParser(
        description="ZeroMQ Publisher for DDALAB Streaming",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument(
        "--endpoint",
        default="tcp://*:5555",
        help="ZMQ bind endpoint (default: tcp://*:5555)",
    )

    parser.add_argument(
        "--topic", default="", help="Topic prefix for pub/sub (optional)"
    )

    # Synthetic data options
    parser.add_argument(
        "--synthetic", action="store_true", help="Generate synthetic EEG-like data"
    )

    parser.add_argument(
        "--channels",
        type=int,
        default=8,
        help="Number of channels for synthetic data (default: 8)",
    )

    parser.add_argument(
        "--sfreq",
        type=float,
        default=250.0,
        help="Sample rate for synthetic data in Hz (default: 250)",
    )

    parser.add_argument(
        "--chunk-size", type=int, default=250, help="Samples per chunk (default: 250)"
    )

    # EDF file options
    parser.add_argument("--edf", help="Path to EDF file to stream")

    parser.add_argument(
        "--loop", action="store_true", help="Loop the EDF file continuously"
    )

    args = parser.parse_args()

    if not args.synthetic and not args.edf:
        parser.error("Either --synthetic or --edf must be specified")

    if args.synthetic:
        publish_synthetic(
            args.endpoint, args.channels, args.sfreq, args.chunk_size, args.topic
        )
    elif args.edf:
        publish_from_edf(
            args.endpoint, args.edf, args.chunk_size, args.loop, args.topic
        )


if __name__ == "__main__":
    main()
