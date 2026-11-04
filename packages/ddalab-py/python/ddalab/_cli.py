"""The `ddalab` command of the wheel: the native command line, run in this process."""

import os
import signal
import sys

from . import _core


def _liblsl() -> None:
    """Points `ddalab stream` at the liblsl pylsl ships, when pylsl is installed and no other is named."""
    if sys.argv[1:2] != ["stream"] or "DDALAB_LIBLSL" in os.environ:
        return
    try:
        from pylsl import lib
    except Exception:  # no pylsl, or one that could not load its library: `ddalab stream` says what to install
        return
    os.environ["DDALAB_LIBLSL"] = lib.lib._name


def main() -> None:
    # Python's own SIGINT handler would wait for the run to return; the default ends it as the native program does.
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    _liblsl()
    sys.exit(_core.cli(["ddalab", *sys.argv[1:]]))
