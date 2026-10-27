"""The wheel's `ddalab` command is the native command line, run in process."""

import subprocess
import sys

import ddalab


def ddalab_command(*args):
    return subprocess.run([sys.executable, "-m", "ddalab", *args], capture_output=True, text=True)


def test_version():
    done = ddalab_command("--version")
    assert done.returncode == 0
    assert done.stdout == f"ddalab {ddalab.__version__}\n"


def test_a_missing_file_returns_the_input_error_code():
    done = ddalab_command("validate", "--file", "/nonexistent/recording.edf")
    assert done.returncode == 1
    assert "nonexistent" in done.stderr


def test_a_usage_error_returns_two():
    assert ddalab_command("frobnicate").returncode == 2
