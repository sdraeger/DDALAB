# DDALAB &mdash; Delay Differential Analysis Laboratory

**DDALAB** is a native desktop application designed for performing **Delay Differential Analysis (DDA)** on neurophysiological time series.

It combines a modern, responsive user interface with a high-performance **Rust** analysis engine, delivering interactive, large-scale DDA workflows while ensuring that **all data processing remains local** to the user’s machine. Built with **Tauri** and **React**, DDALAB offers the ergonomics of a desktop app, the raw performance of compiled systems code, and the reproducibility required for scientific research.

## Table of Contents

- [Download & Installation](#download--installation)
  - [macOS](#macos)
  - [Windows](#windows)
  - [Linux](#linux)
- [Community & Learning](#community--learning)
- [Key Features](#key-features)
- [Architecture Overview](#architecture-overview)
  - [Core Application Stack](#core-application-stack)
  - [Optional Network Deployment](#optional-network-deployment)
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
Visit our [Web Download Portal](https://snl.salk.edu/~claudia/DDALAB/ddalab.html) for a simplified, one-click selection for macOS, Windows, and Linux.

### macOS

1. Download the latest `.dmg` from the portal or releases page.
2. Open the disk image and drag **DDALAB** into your `Applications` folder.
3. **Remove Quarantine Flag:** macOS blocks unsigned applications by default. To allow the app to run, execute the following command in your terminal:
   `sudo xattr -r -d com.apple.quarantine /Applications/DDALAB.app`

   > **Note:** DDALAB is currently unsigned to avoid Apple Developer program constraints. All computation occurs locally; no data is transmitted externally.

4. Launch DDALAB from your Applications folder.

### Windows

1. Download the latest `.msi` installer.
2. Run the installer and follow the setup wizard.
3. Launch DDALAB from the Start menu.

### Linux

1. Download either the `.AppImage` or `.deb` package.
2. **For AppImage:**
   `chmod +x DDALAB-*.AppImage`
   `./DDALAB-*.AppImage`
3. **For Debian/Ubuntu:**
   `sudo dpkg -i DDALAB-*.deb`
   `sudo apt-get install -f`

## Community & Learning

To stay informed about upcoming **workshops**, new **computational tools**, and latest research from our lab, we encourage you to periodically check the official [DDALAB Website](https://snl.salk.edu/~claudia/).

These events often cover advanced DDA workflows, data interpretation strategies, and hands-on training sessions that can help you get the most out of DDALAB.

## Key Features

- **Native Desktop Experience:** Fast, lightweight UI built with Tauri v2 and React.
- **High-Performance Backend:** Embedded Rust API with no external runtime dependencies.
- **Broad Format Support:** Native support for EDF, FIFF (`.fif`), ASCII/TXT, CSV, BrainVision (`.vhdr`), and EEGLAB (`.set`).
- **BIDS Compatibility:** Native handling of Brain Imaging Data Structure datasets.
- **OpenNeuro & NEMAR Integration:** Browse and download public datasets directly within the application.
- **HPC Integration:** Run large-scale computations on the **Neuroscience Gateway (NSG)** for free using your institutional credentials.
- **Complete Data Privacy:** Zero cloud dependency—all computation is local.
- **Interactive Visualization:** Real-time heatmaps and time-series plots powered by ECharts.
- **Multi-Variant DDA:** Support for both classic DDA and cross-time-series (CT) variants.
- **Persistent History:** Analyses and metadata are stored locally using SQLite.

## Architecture Overview

DDALAB is designed as a modular, high-performance scientific application.

### Core Application Stack

- **Tauri v2:** Native desktop framework.
- **React + Next.js (TypeScript):** Modern frontend architecture.
- **Embedded Rust API:** Axum-based local web server.
- **SQLite:** Persistent local storage for analysis history.
- **ECharts:** Interactive, GPU-accelerated plotting.
- **TanStack Query:** Efficient data fetching and caching.

### Optional Network Deployment

For shared or institutional use, DDALAB supports optional network components:

1. **Sync Broker (Rust):** A lightweight service for synchronizing analyses between machines.
2. **Network API Server:** A centralized backend for multiple clients.

To start the broker:
`cd packages/ddalab-broker`
`docker-compose up -d`

## Quick Start Guide

1. **Launch DDALAB** and select a local data directory.
2. **Load Data:** Import local files, BIDS datasets, or download from OpenNeuro.
3. **Configure Parameters:** Select Channels, Window length, Delay range, and DDA variant.
4. **Run Analysis:** Execute the workflow and monitor progress.
5. **Visualize:** Inspect results using the interactive heatmaps and time-series views.
6. **Export:** Save results for downstream analysis.

## Development

### Prerequisites

- **Rust** ≥ 1.70 ([rustup.rs](https://rustup.rs))
- **Node.js** ≥ 18
- **System Dependencies:** Xcode Tools (macOS), MSVC (Windows), or `build-essential` & `libwebkit2gtk` (Linux).

### Getting Started

`git clone https://github.com/sdraeger/DDALAB.git`
`cd DDALAB`
`bun install`
`cd packages/ddalab-tauri`
`bun run tauri:dev`

### Production Build

`bun run tauri build`
Artifacts are generated in `src-tauri/target/release/bundle/`.

## Configuration & Data Storage

DDALAB stores all data locally in OS-specific directories:

- **macOS:** `~/Library/Application Support/ddalab/`
- **Windows:** `%APPDATA%\ddalab\`
- **Linux:** `~/.local/share/ddalab/`

**Key Files:**

- `ddalab.db`: SQLite database for history.
- `config.json`: User preferences.
- `logs/`: Diagnostic logs.

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
