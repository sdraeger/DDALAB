#!/usr/bin/env python3
"""Test script to verify EDF segmentation duration fix."""

import os
import sys
import tempfile
from pathlib import Path

# Add the parent directory to the path so we can import our modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.edf.edf_navigator import EDFNavigator
from schemas.edf.segment import Segment, TimeDeltaParts


def test_segmentation_duration():
    """Test that segmentation produces files with correct duration."""

    # Create a test segment: 2 minutes 53 seconds
    test_segment = Segment(
        start=TimeDeltaParts(days=0, hours=0, minutes=0, seconds=0),
        end=TimeDeltaParts(days=0, hours=0, minutes=2, seconds=53),
    )

    # Expected duration in seconds: 2*60 + 53 = 173 seconds
    expected_duration = 2 * 60 + 53

    print(f"Testing segmentation with expected duration: {expected_duration} seconds")
    print(f"Segment: {test_segment.start} to {test_segment.end}")

    test_file_path = "/Users/simon/Desktop/copy.edf"

    if not os.path.exists(test_file_path):
        print(f"Test file not found: {test_file_path}")
        print("Please provide a valid EDF file path for testing")
        return

    try:
        # Create navigator and segment
        navigator = EDFNavigator(test_file_path)

        # Create temporary output file
        with tempfile.NamedTemporaryFile(suffix=".edf", delete=False) as tmp_file:
            output_path = tmp_file.name

        # Perform segmentation
        edf_file = navigator.segment(test_segment)
        success = navigator.write_file(edf_file, output_path)

        if not success:
            print("Failed to write segmented file")
            return

        # Validate the written file
        validation_nav = EDFNavigator(output_path)
        actual_duration = validation_nav.file_duration_seconds
        print(f"Actual duration: {actual_duration:.2f} seconds")
        print(f"Expected duration: {expected_duration:.2f} seconds")

        if abs(actual_duration - expected_duration) < 1.0:
            print("✅ SUCCESS: Duration matches expected value")
        else:
            print("❌ FAILURE: Duration does not match expected value")
            print(f"Difference: {abs(actual_duration - expected_duration):.2f} seconds")

        # Clean up
        os.unlink(output_path)

    except Exception as e:
        print(f"Error during testing: {e}")


if __name__ == "__main__":
    test_segmentation_duration()
