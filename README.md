<picture>
  <source media="(prefers-color-scheme: dark)" srcset="packages/ddalab-web/public/logo-dark.svg">
  <img src="packages/ddalab-web/public/logo-light.svg" alt="DDALAB logo" height="48">
</picture>

# DDALAB &mdash; Delay Differential Analysis Laboratory

**DDALAB** is a local-first analysis environment for performing **Delay Differential Analysis (DDA)** on neurophysiological time series.

It combines a Python command-line interface, a Qt desktop application, and a native **Rust** analysis engine. Analysis runs locally and recordings never leave the machine. The app goes online only to check for updates, search OpenNeuro, and manage NSG jobs.

The **web app** needs no installation: open <https://sdraeger.github.io/DDALAB/>. Its engine runs in the browser as WebAssembly and recordings stay on your machine (see [`packages/ddalab-web`](packages/ddalab-web/README.md)).

## Table of Contents

- [Use DDALAB](#use-ddalab)
  - [In the browser](#in-the-browser)
  - [Install the web app](#install-the-web-app)
  - [Updates](#updates)
  - [Uninstall](#uninstall)
  - [Command line](#command-line)
  - [Sites that block outside websites](#sites-that-block-outside-websites)
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

## Use DDALAB

### In the browser

Open <https://sdraeger.github.io/DDALAB/> in Chrome, Edge, Firefox or Safari on a desktop or laptop. Choose Open files or Open folder, or drag recordings onto the window. Files are read in place and are never uploaded. A window narrower than 768 pixels (a phone, for example) shows a notice that DDALAB needs a wider window.

### Install the web app

Installing is optional. It gives DDALAB its own window and lets it start without a network.

| Browser | Steps |
| --- | --- |
| Chrome | Click the install icon at the right of the address bar. Or open the ⋮ menu, choose Cast, save, and share, then Install DDALAB. |
| Edge | Click App available in the address bar. Or open the ⋯ menu, choose Apps, then Install DDALAB. |
| Safari 17 or later, macOS 14 or later | Choose File, then Add to Dock. |
| Firefox | Firefox has no desktop install. Bookmark the address. |

Start the installed app from the Dock, Launchpad, Spotlight or the Applications folder on macOS, or from the Start menu, the taskbar or a desktop shortcut on Windows. It runs in its own window and works offline after the first launch. Offline, OpenNeuro search and streaming stay unavailable.

Installed Chrome and Edge add a few things:

- Open With, then DDALAB, in Finder or Explorer for .edf, .bdf, .vhdr, .csv, .tsv and .txt files (Chrome asks once per file type). A .vhdr opened alone asks you to choose its folder to find its companion files, unless a folder you have open already holds it.
- Exports go through the system Save dialog. Chrome and Edge tabs do the same. Other browsers download the file.
- Open tabs return when you restart. Chrome asks for read access to each file again unless you choose Allow on every visit.

### Updates

Updates are automatic. A new version is published when a `v*` tag is pushed. The tag must equal the version of `dda-rs`, `ddalab-wasm` and `ddalab-web`, or the release workflow fails. The next launch with a network connection downloads the new version in the background and shows "A new version of DDALAB is ready" with a Reload button. A window that stays open looks again once an hour. While an analysis runs, the notice says the new version will be ready after the run, and Reload waits for the run to end.

If you ignore the notice, the new version takes over once every DDALAB window has been closed and opened again. When you reload one of several windows, the others keep working and show the notice again. Without a network the cached version keeps working. About shows the version and the engine commit. Results, history, annotations and tabs stay across updates. Pre-release tags (a `-` in the tag) are not published to the site.

### Uninstall

In Chrome or Edge, open the menu of the app window and choose Uninstall DDALAB. In Safari, remove DDALAB from the Dock and from the Applications folder. Stored results stay in the browser until you clear that site's data.

### Command line

`ddalab` is a native program for batch runs and GPUs. It runs the same engine as the web app, and it also runs the CCD family, which the web app does not.

Install it with Python's tools. Python 3.8 or later is needed only to install it, and uv fetches an interpreter when there is none:

```sh
uv tool install ddalab      # or: pipx install ddalab, or: pip install ddalab
ddalab --version            # prints: ddalab 2.0.0
uv tool upgrade ddalab      # or: pipx upgrade ddalab
```

The wheel holds only the `ddalab` executable. No Python code runs; Python only installs it. Wheels cover Linux x86-64, Windows x86-64, and macOS 11 or later on Intel and on Apple silicon. The Linux wheel and archive are built with CUDA: `--device cuda` runs on NVIDIA GPUs and loads the driver at run time. The default CPU device needs no CUDA. Installing with uv or pipx also avoids the macOS warning for unsigned downloads.

The main commands:

```sh
ddalab inspect --file recording.edf
ddalab run --file recording.edf --variants ST --wl 1000 --ws 200 --delays 7 10 --bundle out
ddalab batch --help
```

Without Python, download the archive for your system from the [release page](https://github.com/sdraeger/DDALAB/releases): `ddalab-<version>-linux-x64.tar.gz`, `ddalab-<version>-macos-x64.tar.gz`, `ddalab-<version>-macos-arm64.tar.gz` or `ddalab-<version>-windows-x64.zip`. Each comes with a `.sha256` file. An archive unpacks to a folder `ddalab-<version>-<platform>/` that holds `ddalab` (`ddalab.exe` on Windows), `LICENSE` and `README.md`. Verify the archive, unpack it and put the folder on your PATH. The programs are unsigned.

- Linux: `sha256sum -c ddalab-<version>-linux-x64.tar.gz.sha256`, then `tar -xzf ddalab-<version>-linux-x64.tar.gz`.
- macOS: `shasum -a 256 -c ddalab-<version>-macos-arm64.tar.gz.sha256`, then `tar -xzf ddalab-<version>-macos-arm64.tar.gz`, then `xattr -dr com.apple.quarantine ddalab-<version>-macos-arm64` to remove the quarantine a browser download sets.
- Windows (PowerShell): `Get-FileHash ddalab-<version>-windows-x64.zip` and compare the hash with the one in the `.sha256` file, then `Expand-Archive ddalab-<version>-windows-x64.zip .`. If SmartScreen blocks the program, choose More info, then Run anyway, or run `Unblock-File` on `ddalab.exe`.

To update an archive install, download the new archive. To build from source, run `cargo build --release --locked` in `packages/dda-rs`; the program is `target/release/ddalab`.

### Sites that block outside websites

Download `ddalab-web-<version>.zip` from the [release page](https://github.com/sdraeger/DDALAB/releases) and unzip it onto any internal static web server. The server must use HTTPS (or be `localhost`), because the app needs a secure context. Users open that address and everything above applies. Update by replacing the files. Opening `index.html` from disk does not work, because browsers do not start workers from `file://` pages. See [`packages/ddalab-web`](packages/ddalab-web/README.md) for the server settings and a warning about hosts that share one origin between users.

## Download & Installation

Prebuilt binaries are available for all major platforms via [GitHub Releases](https://github.com/sdraeger/DDALAB/releases).

**Need help choosing the right file?**
Visit our [Web Download Portal](https://sdraeger.github.io/DDALAB/DDALAB/ddalab.html) for a one-click selection for macOS, Windows, and Linux.

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

For upcoming **workshops**, new **computational tools**, and the latest research from our lab, check the official [DDALAB Website](https://sdraeger.github.io/DDALAB/) periodically.

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
