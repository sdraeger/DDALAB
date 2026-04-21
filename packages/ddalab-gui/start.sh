#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "x86_64" ]]; then
  if [[ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" == "1" ]]; then
    exec arch -arm64 /bin/bash "$0" "$@"
  fi
fi

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"
REPO_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"
CLI_ROOT="$REPO_ROOT/packages/ddalab-cli"

NATIVE_ARM64=0
PYTHON_BIN=""
DDA_CLI_PATH_DEFAULT="$REPO_ROOT/packages/dda-rs/target/release/ddalab"

configure_platform_env() {
  if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
    export _PYTHON_HOST_PLATFORM="macosx-11.0-arm64"
    export ARCHFLAGS="-arch arm64"
    NATIVE_ARM64=1
  fi
}

python3_native() {
  local python_cmd="${PYTHON_BIN:-python3}"
  if [[ "$NATIVE_ARM64" -eq 1 ]]; then
    arch -arm64 "$python_cmd" "$@"
  else
    "$python_cmd" "$@"
  fi
}

python_native() {
  if [[ "$NATIVE_ARM64" -eq 1 ]]; then
    arch -arm64 python "$@"
  else
    python "$@"
  fi
}

venv_python() {
  local python_bin="$ROOT_DIR/.venv/bin/python"
  if [[ "$NATIVE_ARM64" -eq 1 ]]; then
    arch -arm64 "$python_bin" "$@"
  else
    "$python_bin" "$@"
  fi
}

select_python() {
  local candidates=(python3.12 python3.11 python3)
  local candidate
  local major_minor

  for candidate in "${candidates[@]}"; do
    if ! command -v "$candidate" >/dev/null 2>&1; then
      continue
    fi

    if [[ "$NATIVE_ARM64" -eq 1 ]]; then
      major_minor="$(arch -arm64 "$candidate" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"
    else
      major_minor="$("$candidate" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"
    fi

    if [[ "$major_minor" =~ ^3\.(11|12)$ ]]; then
      PYTHON_BIN="$candidate"
      return 0
    fi
  done

  echo "Error: a supported Python interpreter was not found."
  echo "Install python3.12 or python3.11, then rerun ./start.sh."
  return 1
}

create_venv() {
  python3_native -m venv .venv
  source .venv/bin/activate
  venv_python -m pip install --upgrade pip
}

venv_healthcheck() {
  venv_python - <<'PY' >/dev/null 2>&1
import numpy
import matplotlib
import mne
import nibabel
import pyxdf
import pynwb
import sklearn
import PySide6
PY
}

venv_python_supported() {
  venv_python - <<'PY' >/dev/null 2>&1
import sys
major, minor = sys.version_info[:2]
raise SystemExit(0 if (major, minor) in {(3, 11), (3, 12)} else 1)
PY
}

install_dependencies() {
  venv_python -m pip install --no-cache-dir -r "$CLI_ROOT/requirements-readers.txt"
  venv_python -m pip install -r "$CLI_ROOT/requirements.txt"
  venv_python -m pip install -e "$CLI_ROOT" -e "$ROOT_DIR"
}

configure_platform_env
select_python

if [[ -z "${DDALAB_CLI_PATH:-}" && -x "$DDA_CLI_PATH_DEFAULT" ]]; then
  export DDALAB_CLI_PATH="$DDA_CLI_PATH_DEFAULT"
fi

if [[ ! -d ".venv" ]]; then
  create_venv
else
  source .venv/bin/activate
  if ! venv_python_supported || ! venv_healthcheck; then
    deactivate 2>/dev/null || true
    rm -rf .venv
    create_venv
  fi
fi

install_dependencies
venv_python -m ddalab_gui "$@"
