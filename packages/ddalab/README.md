# DDALAB

`ddalab` is the unified Python package for DDALAB.

It ships:

- the command-line interface
- the Qt desktop application
- the shared local runtime and dataset readers
- the bundled `dda-rs` backend binary used for local DDA analysis

## Entry Points

Installing this package provides:

- `ddalab`
- `ddalab-cli`
- `ddalab-gui`

`ddalab` and `ddalab-cli` both invoke the CLI entry point. `ddalab-gui` launches the desktop application directly.

## Install

```bash
cd packages/ddalab
python -m pip install .
```

Published wheels and desktop installers bundle the local `dda-rs` backend, so DDA works offline without a separate network service.

For editable or source installs, local DDA analysis also requires a working Rust toolchain with `cargo` so the bundled `dda-rs` binary can be built for your platform.

## CLI Examples

```bash
ddalab health
ddalab dataset info --file data/MG100_Seizure1.edf
ddalab dda info --json
ddalab dda validate data/MG100_Seizure1.edf --json
ddalab dda run data/MG100_Seizure1.edf --channels 0 1 2 --variants ST SY --end 30
ddalab dda batch --bids-dir data/ds003029 --variants ST --continue-on-error
```

## Desktop Development

```bash
cd packages/ddalab
./start.sh
```

The script provisions a local virtual environment, installs the unified package in editable mode, and launches the Qt application.

If you are working from source, `./start.sh` expects `cargo` to be available so it can build or refresh the bundled `dda-rs` runtime.

## Smoke Test

```bash
cd packages/ddalab
./start.sh --smoke-test
```
