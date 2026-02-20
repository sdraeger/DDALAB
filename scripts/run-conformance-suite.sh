#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[conformance] dda-rs"
cargo test --manifest-path packages/dda-rs/Cargo.toml --test conformance_contract_tests

echo "[conformance] dda-py"
python3 -m pytest -q packages/dda-py/tests/test_conformance_contract.py

echo "[conformance] DelayDifferentialAnalysis.jl"
(
  cd packages/DelayDifferentialAnalysis.jl
  julia --project=. -e 'using Pkg; Pkg.instantiate(); include("test/test_conformance_contract.jl")'
)

echo "[conformance] done"
