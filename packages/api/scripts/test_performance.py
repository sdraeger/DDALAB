#!/usr/bin/env python3
"""Performance test script to measure chunk loading improvements."""

import os
import sys
import time
from pathlib import Path

# Add the parent directory to the path so we can import our modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.edf.utils import read_edf_chunk
from loguru import logger


def test_chunk_loading_performance(file_path: str, chunk_size: int = 25600):
    """Test chunk loading performance for a given file."""

    if not os.path.exists(file_path):
        logger.error(f"Test file not found: {file_path}")
        return

    logger.info(f"Testing chunk loading performance for: {file_path}")
    logger.info(f"Chunk size: {chunk_size} samples")

    # Test multiple chunks to get average performance
    test_chunks = [0, 10000, 50000, 100000, 200000]
    results = []

    for chunk_start in test_chunks:
        start_time = time.time()
        try:
            edf_file, total_samples = read_edf_chunk(
                file_path, chunk_start, chunk_size, None
            )
            elapsed_time = time.time() - start_time

            num_signals = len(edf_file.signals)
            logger.info(
                f"Chunk {chunk_start}-{chunk_start + chunk_size}: "
                f"{elapsed_time:.3f}s, {num_signals} signals"
            )

            results.append(
                {
                    "chunk_start": chunk_start,
                    "elapsed_time": elapsed_time,
                    "num_signals": num_signals,
                    "chunk_size": chunk_size,
                }
            )

        except Exception as e:
            logger.error(f"Error loading chunk at {chunk_start}: {e}")

    # Calculate statistics
    if results:
        avg_time = sum(r["elapsed_time"] for r in results) / len(results)
        min_time = min(r["elapsed_time"] for r in results)
        max_time = max(r["elapsed_time"] for r in results)

        logger.info("\nPerformance Summary:")
        logger.info(f"Average time: {avg_time:.3f}s")
        logger.info(f"Min time: {min_time:.3f}s")
        logger.info(f"Max time: {max_time:.3f}s")
        logger.info(
            f"Total signals processed: {sum(r['num_signals'] for r in results)}"
        )

        return {
            "avg_time": avg_time,
            "min_time": min_time,
            "max_time": max_time,
            "total_signals": sum(r["num_signals"] for r in results),
        }

    return None


def test_preprocessing_performance(file_path: str, chunk_size: int = 25600):
    """Test preprocessing performance impact."""

    if not os.path.exists(file_path):
        logger.error(f"Test file not found: {file_path}")
        return

    logger.info(f"Testing preprocessing performance for: {file_path}")

    # Test with different preprocessing options
    preprocessing_options = [
        None,
        {"removeOutliers": True},
        {"smoothing": True, "smoothingWindow": 5},
        {"normalization": "zscore"},
        {"removeOutliers": True, "smoothing": True, "normalization": "minmax"},
    ]

    results = []

    for i, options in enumerate(preprocessing_options):
        start_time = time.time()
        try:
            edf_file, total_samples = read_edf_chunk(file_path, 0, chunk_size, options)
            elapsed_time = time.time() - start_time

            option_name = "None" if options is None else str(options)
            logger.info(f"Preprocessing {option_name}: {elapsed_time:.3f}s")

            results.append(
                {
                    "options": option_name,
                    "elapsed_time": elapsed_time,
                    "num_signals": len(edf_file.signals),
                }
            )

        except Exception as e:
            logger.error(f"Error with preprocessing {options}: {e}")

    return results


if __name__ == "__main__":
    # Test with a sample EDF file
    test_file = "/Users/simon/Desktop/copy.edf"  # Update this path

    if not os.path.exists(test_file):
        logger.error("Please update the test_file path to point to a valid EDF file")
        sys.exit(1)

    logger.info("=== Chunk Loading Performance Test ===")
    basic_results = test_chunk_loading_performance(test_file)

    logger.info("\n=== Preprocessing Performance Test ===")
    preprocessing_results = test_preprocessing_performance(test_file)

    if basic_results:
        logger.info("\n=== Summary ===")
        logger.info(f"Basic chunk loading: {basic_results['avg_time']:.3f}s average")
        if preprocessing_results:
            avg_preprocessing = sum(
                r["elapsed_time"] for r in preprocessing_results
            ) / len(preprocessing_results)
            logger.info(f"With preprocessing: {avg_preprocessing:.3f}s average")
            logger.info(
                f"Preprocessing overhead: {avg_preprocessing - basic_results['avg_time']:.3f}s"
            )
