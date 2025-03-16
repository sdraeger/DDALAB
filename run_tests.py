#!/usr/bin/env python3
"""Script to run tests for DDALAB."""

import os
import subprocess
import sys
from pathlib import Path


def run_tests():
    """Run tests using tox."""
    print("Running tests for DDALAB...")

    # Get the directory of this script
    script_dir = Path(__file__).parent.absolute()

    # Change to the script directory
    os.chdir(script_dir)

    # Run tox with any arguments passed to this script
    args = ["tox"]
    if len(sys.argv) > 1:
        args.extend(sys.argv[1:])

    result = subprocess.run(args)
    return result.returncode


if __name__ == "__main__":
    sys.exit(run_tests())
