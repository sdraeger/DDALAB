#!/usr/bin/env python3
"""Test runner script for the FastAPI server test suite."""

import os
import subprocess
import sys
from pathlib import Path


def setup_python_path():
    """Set up the Python path to ensure imports work correctly."""
    # Get the API package directory (where this script is located)
    api_dir = Path(__file__).parent.parent.resolve()

    # Add the API directory to Python path so imports work
    if str(api_dir) not in sys.path:
        sys.path.insert(0, str(api_dir))

    # Also set PYTHONPATH environment variable for subprocesses
    pythonpath = os.environ.get("PYTHONPATH", "")
    if str(api_dir) not in pythonpath:
        if pythonpath:
            os.environ["PYTHONPATH"] = f"{api_dir}:{pythonpath}"
        else:
            os.environ["PYTHONPATH"] = str(api_dir)


def run_command(cmd, description):
    """Run a command and return the result."""
    print(f"\n🔄 {description}")
    print(f"Running: {cmd}")

    # Set up the environment
    setup_python_path()

    # Change to the API directory
    api_dir = Path(__file__).parent.parent.resolve()

    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            cwd=str(api_dir),  # Run from the API directory
            env=os.environ.copy(),  # Use the modified environment
        )

        if result.returncode == 0:
            print(f"✅ {description} passed")
            if result.stdout:
                print("STDOUT:")
                print(result.stdout)
            return True
        else:
            print(f"❌ {description} failed")
            print(f"Exit code: {result.returncode}")
            if result.stdout:
                print("STDOUT:")
                print(result.stdout)
            if result.stderr:
                print("STDERR:")
                print(result.stderr)
            return False
    except Exception as e:
        print(f"❌ {description} failed with exception: {e}")
        return False


def main():
    """Main test runner function."""
    if len(sys.argv) < 2:
        print("Usage: python tests/test_runner.py <test_type>")
        print("Available test types:")
        print("  unit       - Run unit tests only")
        print("  integration - Run integration tests only")
        print("  auth       - Run authentication tests only")
        print("  database   - Run database tests only")
        print("  coverage   - Run all tests with coverage report")
        print("  all        - Run all tests")
        print("  setup      - Set up test environment")
        sys.exit(1)

    test_type = sys.argv[1].lower()

    # Set up Python path
    setup_python_path()

    if test_type == "unit":
        success = run_command(
            "PYTHONPATH=. python -m pytest tests/unit/ -v -m unit", "Running unit tests"
        )
    elif test_type == "integration":
        success = run_command(
            "PYTHONPATH=. python -m pytest tests/integration/ -v -m integration",
            "Running integration tests",
        )
    elif test_type == "auth":
        success = run_command(
            "PYTHONPATH=. python -m pytest tests/ -v -m auth",
            "Running authentication tests",
        )
    elif test_type == "database":
        success = run_command(
            "PYTHONPATH=. python -m pytest tests/ -v -m database",
            "Running database tests",
        )
    elif test_type == "coverage":
        success = run_command(
            "PYTHONPATH=. python -m pytest tests/ --cov=. --cov-report=html --cov-report=term-missing",
            "Running all tests with coverage",
        )
    elif test_type == "all":
        success = run_command(
            "PYTHONPATH=. python -m pytest tests/ -v", "Running all tests"
        )
    elif test_type == "setup":
        success = run_command(
            "pip install -r test_requirements.txt", "Installing test dependencies"
        )
    else:
        print(f"❌ Unknown test type: {test_type}")
        success = False

    if success:
        print(f"\n🎉 {test_type.title()} tests completed successfully!")
        sys.exit(0)
    else:
        print(f"\n💥 {test_type.title()} tests failed!")
        sys.exit(1)


if __name__ == "__main__":
    main()
