#!/bin/sh
# Builds the library for the browser and runs the native tests.
set -eu
cd "$(dirname "$0")/.."
cargo build --lib --target wasm32-unknown-unknown --release
cargo test --release
