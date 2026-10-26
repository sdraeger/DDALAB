<img src="packages/ddalab-web/public/favicon.svg" alt="DDALAB logo" height="56">

# DDALAB: Delay Differential Analysis Laboratory

DDALAB runs **Delay Differential Analysis (DDA)** on neurophysiological recordings. One Rust core, `dda-rs`, serves two front ends: a web application that runs it as WebAssembly in your browser, and the `ddalab` command-line tool for batch and GPU work. Recordings are read from your disk in place and never uploaded.

## Web application

Open **<https://sdraeger.github.io/DDALAB/>**. There is nothing to install.

The app opens EDF, BDF, BrainVision, and delimited text (ASCII, TXT, CSV) recordings, shows the waveform at pixel resolution, runs the ST, CT, CD, DE, and SY flavors, and exports result bundles (a manifest plus `.npy` arrays), result JSON, and CSV. Analysis history and caches stay in your browser (OPFS and IndexedDB).

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
ddalab --version            # prints: ddalab 2.0.1
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

Workshops, new tools, and recent work from the lab are listed on the [lab website](https://sdraeger.github.io/DDALAB/).

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
