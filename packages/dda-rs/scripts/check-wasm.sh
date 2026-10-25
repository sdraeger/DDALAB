#!/bin/sh
# Builds the library and the wasm ABI for the browser, runs the native tests, then the ABI's Node tests.
set -eu
cd "$(dirname "$0")/.."
cargo build --lib --target wasm32-unknown-unknown --release
cargo test --release
# The ABI's .cargo/config.toml (simd128) applies only when cargo runs in its directory.
(cd ../ddalab-wasm && cargo build --release --target wasm32-unknown-unknown)
if command -v node >/dev/null 2>&1; then
	node --test ../ddalab-wasm/node/
else
	echo "node is not on PATH; skipping the wasm ABI tests"
fi
