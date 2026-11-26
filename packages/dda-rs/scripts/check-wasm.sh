#!/bin/sh
# Builds the library and the wasm ABI for the browser, runs the native tests, then the ABI's Node tests.
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
cargo build --lib --target wasm32-unknown-unknown --release -p dda-rs
cargo test --release -p dda-rs
cargo build --release -p dda-rs --bin ddalab --example dump_tiles
cargo build --profile wasm-release --target wasm32-unknown-unknown -p ddalab-wasm
if command -v node >/dev/null 2>&1; then
	node --test packages/ddalab-wasm/node/
else
	echo "node is not on PATH; skipping the wasm ABI tests"
fi
