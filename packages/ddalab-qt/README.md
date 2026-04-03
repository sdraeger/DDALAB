# DDALAB Qt Prototype

`ddalab-qt` is a standalone Qt desktop prototype for DDALAB. It is intentionally shaped around the existing Tauri desktop layout:

- top command bar with dataset status and run actions
- file tabs
- persistent library sidebar
- primary and secondary navigation
- visualization workspace with channel inspector, waveform, and overview
- DDA configuration and heatmap result view
- OpenNeuro browser

The prototype uses a bundled local DDALAB bridge for desktop file/data/analysis work and OpenNeuro's public GraphQL API for remote catalog browsing.

## Current scope

Implemented:

- local bridge health and filesystem browsing
- dataset metadata loading
- waveform window and overview loading
- channel selection
- viewport pan/zoom/jump interactions
- local DDA execution through the bundled bridge
- DDA heatmap rendering
- direct OpenNeuro dataset browsing
- multi-file tabs

Prototype-only / intentionally incomplete:

- plugins, NSG jobs, collaboration, and workflow recording
- desktop updater and CLI install management
- full annotation system
- export/import parity with Tauri/KMP

## Run

Run the Qt prototype:

```bash
cd /Users/simon/Desktop/DDALAB-codex-hardening-pass-1/packages/ddalab-qt
./start.sh
```

On the first run, the app will build the bundled local bridge from `packages/ddalab-kmp/serverApp`.

The default mode is local desktop execution through the bundled bridge. You can also point it at a remote server URL if you explicitly want institutional/shared HTTP mode:

```bash
./start.sh --server http://127.0.0.1:8081
```

## Smoke test

```bash
cd /Users/simon/Desktop/DDALAB-codex-hardening-pass-1/packages/ddalab-qt
./start.sh --smoke-test
```

The smoke test does not require the DDALAB backend to be running. It only verifies that the Qt shell can initialize cleanly.

## Notes

- The prototype uses IBM Plex Sans from the existing KMP resources to stay visually aligned with the current DDALAB direction.
- The waveform and heatmap surfaces are custom-painted with Qt for a closer workstation feel than a generic form app.
- Desktop local mode uses a packaged `stdin/stdout` bridge instead of localhost HTTP, so it avoids the detached local web-server model for normal Qt usage.
