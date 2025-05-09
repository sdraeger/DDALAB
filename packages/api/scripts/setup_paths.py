import sys
from pathlib import Path


def configure_paths():
    server_dir = Path(__file__).resolve().parent.parent
    sys.path.append(str(server_dir.parent))


# Run at import time
configure_paths()
