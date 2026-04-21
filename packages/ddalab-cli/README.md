# DDALAB CLI

`ddalab` is the active Python command-line package for DDALAB.

It ships the local Python data/runtime layer plus the bundled Rust DDA backend, and it exposes:

- `ddalab health`
- `ddalab dataset info`
- `ddalab waveform window`
- `ddalab waveform overview`
- `ddalab ica run`
- `ddalab dda info`
- `ddalab dda variants`
- `ddalab dda validate`
- `ddalab dda run`
- `ddalab dda batch`
- `ddalab gui` to launch the desktop application when Qt dependencies are present

## Install

```bash
cd packages/ddalab-cli
python -m pip install .
```

This installs:

- `ddalab`
- `ddalab-cli`

Published wheels bundle the local `dda-rs` backend, so DDA works offline without a separate network service. The public `ddalab dda ...` commands are Python-owned and use the bundled Rust engine internally.

## Examples

```bash
ddalab health
ddalab dataset info --file data/MG100_Seizure1.edf
ddalab dda info --json
ddalab dda validate data/MG100_Seizure1.edf --json
ddalab dda run data/MG100_Seizure1.edf --channels 0 1 2 --variants ST SY --end 30
ddalab dda batch --bids-dir data/ds003029 --variants ST --continue-on-error
```

## GUI

The dedicated Qt launcher now lives in `packages/ddalab-gui`.
