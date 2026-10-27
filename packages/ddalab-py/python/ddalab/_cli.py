"""The `ddalab` command of the wheel: the native command line, run in this process."""

import signal
import sys

from . import _core


def main() -> None:
    # Python's own SIGINT handler would wait for the run to return; the default ends it as the native program does.
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    sys.exit(_core.cli(["ddalab", *sys.argv[1:]]))
