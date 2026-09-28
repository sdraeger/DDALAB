# DDALAB &mdash; Delay Differential Analysis Laboratory

**DDALAB** is a local-first analysis environment for performing **Delay Differential Analysis (DDA)** on neurophysiological time series.

It combines a Python command-line interface, a Qt desktop application, and a native **Rust** analysis engine. Analysis runs locally and recordings never leave the machine. The app goes online only to check for updates, search OpenNeuro, and manage NSG jobs.

## Table of Contents

- [Download & Installation](#download--installation)
  - [macOS](#macos)
  - [Windows](#windows)
  - [Linux](#linux)
- [Community & Learning](#community--learning)
- [Key Features](#key-features)
- [Architecture Overview](#architecture-overview)
  - [Core Application Stack](#core-application-stack)
- [Quick Start Guide](#quick-start-guide)
- [Development](#development)
  - [Prerequisites](#prerequisites)
  - [Getting Started](#getting-started)
- [Production Build](#production-build)
- [Configuration & Data Storage](#configuration--data-storage)
- [Citation](#citation)
- [Acknowledgments](#acknowledgments)

## Download & Installation

Prebuilt binaries are available for all major platforms via [GitHub Releases](https://github.com/sdraeger/DDALAB/releases).

**Need help choosing the right file?**
Visit our [Web Download Portal](https://snl.salk.edu/~claudia/DDALAB/ddalab.html) for a one-click selection for macOS, Windows, and Linux.

### macOS

1. Download the latest `.dmg` from the portal or releases page.
2. Open the disk image and drag **DDALAB** into your `Applications` folder.
3. **Remove Quarantine Flag:** macOS blocks unsigned applications by default. To allow the app to run, execute the following command in your terminal:
   `sudo xattr -r -d com.apple.quarantine /Applications/DDALAB.app`

   > **Note:** DDALAB is currently unsigned to avoid Apple Developer program constraints. All computation occurs locally; no data is transmitted externally.

4. Launch DDALAB from your Applications folder.

### Windows

1. Download the latest `-installer.exe`, or the `-portable.zip` to run without installing.
2. Run the installer and follow the setup wizard.
3. Launch DDALAB from the Start menu.

### Linux

1. Download the `.AppImage` (x86-64, glibc 2.35 or newer).
2. `chmod +x DDALAB-*.AppImage`
3. `./DDALAB-*.AppImage`

## Community & Learning

For upcoming **workshops**, new **computational tools**, and the latest research from our lab, check the official [DDALAB Website](https://snl.salk.edu/~claudia/) periodically.

These events often cover advanced DDA workflows, data interpretation strategies, and hands-on training.

## Key Features

- **Native Desktop Experience:** Qt desktop application delivered through the unified `packages/ddalab` package.
- **Scriptable CLI:** `ddalab` command for health checks, dataset inspection, waveform access, ICA, and bundled DDA commands.
- **Bundled Native Backend:** `dda-rs` binary with no separate native fallback layer or network backend required.
- **Broad Format Support:** EDF/BDF, FIFF, BrainVision, EEGLAB, Neuroscan CNT, GDF, KIT/Yokogawa, CTF, EGI MFF, XDF, NWB, NIfTI, and ASCII/TXT/CSV.
- **BIDS Compatibility:** Native handling of Brain Imaging Data Structure datasets.
- **OpenNeuro Search:** Search the OpenNeuro catalog and open a dataset's page; download datasets with the OpenNeuro CLI or DataLad.
- **NSG Job Management:** Sign in to the **Neuroscience Gateway (NSG)** to list, refresh, download, and cancel existing jobs. Submitting jobs from DDALAB is not available yet.
- **Interactive Visualization:** Viewport-aware waveform, heatmap, and time-series rendering with Qt Quick/QML.
- **Multi-Flavor DDA:** ST, CT, CD, DE, and SY flavors; the CLI also runs the CCD family and takes per-flavor channel pairs (`--variant-pairs`).
- **Persistent History:** Analyses and metadata are stored locally using SQLite.

## Architecture Overview

### Core Application Stack

- **Unified Python Desktop + CLI Package:** `packages/ddalab`
- **Rust Native Analysis Engine:** `packages/dda-rs`
- **SQLite:** Persistent local storage for analysis history.
- **Qt Quick/QML:** GPU-capable, viewport-aware waveform and result visualization.

## Quick Start Guide

1. **Launch DDALAB** and select a local data directory.
2. **Load Data:** Open local files or BIDS datasets.
3. **Configure Parameters:** Select Channels, Window length, Delay range, and DDA flavor.
4. **Run Analysis:** Execute the workflow and monitor progress.
5. **Visualize:** Inspect results using the interactive heatmaps and time-series views.
6. **Export:** Save results for downstream analysis.

## Development

### Prerequisites

- **Rust** ≥ 1.70 ([rustup.rs](https://rustup.rs))
- **Python** 3.11 or 3.12

### Getting Started

`git clone https://github.com/sdraeger/DDALAB.git`
`cd DDALAB/packages/ddalab`
`./start.sh`

### Active Packages

- `packages/ddalab`: unified Python package that installs `ddalab`, `ddalab-cli`, and `ddalab-gui`, bundles the local `dda-rs` backend for packaged releases, and provides the PySide6 desktop application
- `packages/dda-rs`: Rust implementation and native CLI used by the packaged Python application

The Python and Julia language bindings are maintained in their own repositories and may be checked out locally under `packages/dda-py` and `packages/DelayDifferentialAnalysis.jl`.

Useful helper commands:

- `cd packages/ddalab && ./start.sh --smoke-test`
- `cd packages/ddalab && python3 scripts/prepare_runtime.py --clean --print-dir`
- `cd packages/ddalab && ./.venv/bin/python -m build --wheel`

### Production Build

`cd packages/ddalab && ./.venv/bin/pyinstaller DDALAB.spec --noconfirm --clean`

## Configuration & Data Storage

DDALAB stores its data in your home directory on every platform:

- `~/.ddalab/state.sqlite3`: analysis history, annotations, and the saved session and settings.
- `~/.ddalab-qt/logs/`: diagnostic logs.
- NSG sign-in: the system keychain (macOS Keychain, Windows Credential Manager, or a Secret Service keyring such as GNOME Keyring or KWallet on Linux). Without one, DDALAB keeps the sign-in in memory until you quit.

## Citation

```bibtex
@software{draeger-ddalab-2025,
  author = {Dr{\"a}ger, Simon and Lainscsek, Claudia and Sejnowski, Terrence J},
  title = {DDALAB: Delay Differential Analysis Laboratory},
  year = {2025},
  url = {https://github.com/sdraeger/DDALAB}
}

```

## Acknowledgments

Developed with support from **NIH grant 1RF1MH132664-01**.

> **Disclaimer:** DDALAB is a research tool. Users are responsible for validating results against established standards for their specific applications.
