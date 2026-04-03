#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "x86_64" ]]; then
  if [[ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" == "1" ]]; then
    exec arch -arm64 /bin/bash "$0" "$@"
  fi
fi

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

NATIVE_ARM64=0

configure_platform_env() {
  if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
    export _PYTHON_HOST_PLATFORM="macosx-11.0-arm64"
    export ARCHFLAGS="-arch arm64"
    NATIVE_ARM64=1
  fi
}

python3_native() {
  if [[ "$NATIVE_ARM64" -eq 1 ]]; then
    arch -arm64 python3 "$@"
  else
    python3 "$@"
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

create_venv() {
  python3_native -m venv .venv
  source .venv/bin/activate
  venv_python -m pip install --upgrade pip
}

venv_healthcheck() {
  venv_python - <<'PY' >/dev/null 2>&1
import numpy
import mne
import nibabel
import pyxdf
import pynwb
PY
}

install_dependencies() {
  venv_python -m pip install --no-cache-dir -r requirements-readers.txt
  venv_python -m pip install -r requirements.txt
}

configure_platform_env

if [[ ! -d ".venv" ]]; then
  create_venv
else
  source .venv/bin/activate
  if ! venv_healthcheck; then
    deactivate 2>/dev/null || true
    rm -rf .venv
    create_venv
  fi
fi

install_dependencies
venv_python -m ddalab_qt "$@"
