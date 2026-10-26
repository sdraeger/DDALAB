<picture>
  <source media="(prefers-color-scheme: dark)" srcset="packages/ddalab-web/public/logo-dark.svg">
  <img src="packages/ddalab-web/public/logo-light.svg" alt="DDALAB logo" height="48">
</picture>

# DDALAB: Delay Differential Analysis Laboratory

DDALAB runs **Delay Differential Analysis (DDA)** on neurophysiological recordings. One Rust core, `dda-rs`, serves two front ends: a web application that runs it as WebAssembly in your browser, and the `ddalab` command-line tool for batch and GPU work. Recordings are read from your disk in place and never uploaded.

## Web application

Open **<https://sdraeger.github.io/DDALAB/>**. There is nothing to install.

The app opens EDF, BDF, BrainVision, EEGLAB (.set, with its .fdt or with the samples inside), and delimited text (ASCII, TXT, CSV) recordings, shows the waveform at pixel resolution, runs the ST, CT, CD, DE, and SY flavors, and exports result bundles (a manifest plus `.npy` arrays), result JSON, and CSV. Analysis history and caches stay in your browser (OPFS and IndexedDB).

## Use DDALAB

### In the browser

Open <https://sdraeger.github.io/DDALAB/> in Chrome, Edge, Firefox or Safari. Choose Open files or Open folder, or drag recordings onto the window. Files are read in place and are never uploaded. On a phone the library, the waveform and the results each take the screen, chosen in a bar at the bottom; pinch the waveform to zoom, and hold a finger still before dragging to select.

### Public data from OpenNeuro

Search OpenNeuro in the library by words, by modality (EEG or iEEG) or both, ordered by relevance, newest first or by name; More datasets loads the next page. A dataset shows its name, authors, license, DOI and README, with a version menu for its older snapshots and Copy the citation. Its recordings stream in place, a range at a time, and the result of every run on one names the dataset, its snapshot and its citation in its provenance. Find recordings to run on, in any folder of a snapshot, lists the EEG and iEEG recordings there and below as `ddalab batch` finds them; Run on all runs the batch on them, streamed one at a time, and Resume in the History walks the folder again. In the inspector, Keep a copy on this device stores a streamed recording in the browser, which then opens it without the network, where the browser lets a page write files to its storage (Chrome, Edge and Firefox; elsewhere the button does not show); Remove the copy deletes it.

### Share a project

Export project, under Open files in the library, saves the open tabs as one .ddalab file: every file their recordings read (a BrainVision recording's .vhdr, .vmrk and .eeg, and the BIDS sidecars it used), your annotations, the chosen channels and each tab's view, and the results of those recordings with their batches. The panel shows the size before it writes. Reattach or close a detached tab first. A project can carry at most 32 MiB of results (as the History keeps them; one result at most 16 MiB), so that every DDALAB can open it. When the results come to more, the panel says so and offers Export without results, which keeps the recordings, annotations, chosen channels and views; or delete results you do not need in History and export again.

Open a .ddalab in the web app or the installed one, on this computer or another: choose it with Open files, drop it onto the window, or use Open With in installed Chrome and Edge. Its tabs come back with their annotations, channels and views, and its results join the History. Results, batches and annotations you already have are not added twice or changed. A recording DDALAB already knows (from a tab, its annotations, its results or its cached tiles) is checked before anything of the project joins it: DDALAB hashes the project's copy and compares it with the SHA-256 it knows for yours. Only when they are the same do the project's annotations and results for it join, and a tab of yours keeps its place (a detached one opens from the .ddalab for this visit and keeps its own files for the next). Otherwise your recording stays as it is, the copy is not opened, and the message says why and what to do. If the copy differs from yours, it lists what to remove from this browser first if you want the project's copy instead. If this browser has never checked your copy (one annotated before 2.1, for example), open your recording here once, which checks it, and open the project again. If the project's copy could not be read, open the project again. The recordings are read from inside the .ddalab, not copied, so keep the file where it is: a reload reads them from there again, and so does a newer copy of the project saved under the same name. Chrome and Edge read it again without asking for the rest of the session; after a restart they ask once, unless you chose Allow on every visit. Other browsers ask you to choose it again.

A .ddalab is a zip archive whose files are stored uncompressed, so any zip tool unpacks it. `recordings/<n>/` holds the files of each recording, which `ddalab` reads as it reads any recording, and `results/<id>/` the bundle of each result, as `ddalab run --bundle` writes it. `project.json` lists every file with its SHA-256.

### Install the web app

Installing is optional. It gives DDALAB its own window and lets it start without a network.

| Browser | Steps |
| --- | --- |
| Chrome | Click the install icon at the right of the address bar. Or open the ⋮ menu, choose Cast, save, and share, then Install DDALAB. |
| Edge | Click App available in the address bar. Or open the ⋯ menu, choose Apps, then Install DDALAB. |
| Safari 17 or later, macOS 14 or later | Choose File, then Add to Dock. |
| Firefox | Firefox has no desktop install. Bookmark the address. |

Start the installed app from the Dock, Launchpad, Spotlight or the Applications folder on macOS, or from the Start menu, the taskbar or a desktop shortcut on Windows. It runs in its own window and works offline after the first launch. Offline, OpenNeuro search and streaming stay unavailable; a recording kept on the device still opens.

Installed Chrome and Edge add a few things:

- Open With, then DDALAB, in Finder or Explorer for .edf, .bdf, .vhdr, .set, .csv, .tsv, .txt and .ddalab files (Chrome asks once per file type). A .vhdr opened alone asks you to choose its folder to find its companion files, unless a folder you have open already holds it.
- Exports go through the system Save dialog. Chrome and Edge tabs do the same. Other browsers download the file.
- Open tabs return when you restart. Chrome asks for read access to each file again unless you choose Allow on every visit.
- DDALAB's command bar takes the window's title bar, beside the system's window controls. Drag the bar's empty space to move the window. To get the browser's own title bar back, use the chevron beside the window controls (Hide title bar or Show title bar).

In every browser, the DDALAB mark and name at the left of the command bar open the application menu: File, View, Window and Help, with the keyboard shortcuts beside each command (⌘ on a Mac, Ctrl elsewhere). Help, then Keyboard shortcuts lists them all.

Window, then New window opens another DDALAB window. Each window has its own tabs, side panels and views; history, results and annotations are shared, and every window shows what another one adds. A window you close is kept with its tabs: the next launch reopens the one you used last, and Window, then Reopen window lists the others. A window with no tabs is not kept.

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
ddalab --version            # prints: ddalab 2.3.0
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
