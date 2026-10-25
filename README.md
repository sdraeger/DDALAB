# DDALAB: Delay Differential Analysis Laboratory

DDALAB runs **Delay Differential Analysis (DDA)** on neurophysiological recordings. One Rust core, `dda-rs`, serves two front ends: a web application that runs it as WebAssembly in your browser, and the `ddalab` command-line tool for batch and GPU work. Recordings are read from your disk in place and never uploaded.

## Web application

Open **<https://snl.salk.edu/~sfdraeger/ddalab>**. There is nothing to install.

The app opens EDF, BDF, BrainVision, and delimited text (ASCII, TXT, CSV) recordings, shows the waveform at pixel resolution, runs the ST, CT, CD, DE, and SY flavors, and exports result bundles (a manifest plus `.npy` arrays), result JSON, and CSV. Analysis history and caches stay in your browser (OPFS and IndexedDB).

To host it yourself, serve the built `dist/` folder of `packages/ddalab-web` from any static file server.

## Command-line tool

```bash
uv tool install ddalab        # or: pip install ddalab
ddalab inspect recording.edf
ddalab run --file recording.edf --variants ST --wl 1000 --ws 200 --delays 7 10 --bundle out
ddalab batch --help
```

Archives for Linux x64, Windows x64, macOS Intel, and macOS Apple silicon, each with a SHA-256 file, are on [GitHub Releases](https://github.com/sdraeger/DDALAB/releases). The Linux build adds `--device cuda` for NVIDIA GPUs; it loads the CUDA driver at run time, so the default CPU device works without one. The CLI also runs the CCD family (TRCCD, CCDSTAB, and auto-conditioned CCD), which the web app does not.

## Repository layout

- `packages/dda-rs`: the Rust core (engine, readers, tiles, block runner, result documents) and the `ddalab` CLI.
- `packages/ddalab-wasm`: `dda-rs` compiled to `wasm32-unknown-unknown` with a plain `extern "C"` ABI.
- `packages/ddalab-web`: the React and TypeScript web application.

## Development

Prerequisites: stable Rust with the `wasm32-unknown-unknown` target, and Node.js 26.

```bash
sh packages/dda-rs/scripts/check-wasm.sh    # wasm library and ABI build, cargo test --release, ABI Node tests
cd packages/ddalab-web && npm ci && npm run dev
```

`npm run build`, `npm test`, and `npm run test:e2e` build the wasm module first.

A release is a `v*` tag. `.github/workflows/release.yml` builds the CLI archives and the PyPI wheels from that commit and records the commit in every result document (`reproduction.git_commit`).

## Community

Workshops, new tools, and recent work from the lab are listed on the [lab website](https://snl.salk.edu/~claudia/).

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
