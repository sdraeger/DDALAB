# DDALAB Desktop Architecture

`ddalab_app` contains one local application stack used by both the command line
and desktop interfaces. It does not run or require a web server.

## Boundaries

- `cli`: argument parsing and command handlers. Commands use the same local
  backend as the desktop application.
- `backend/local`: local workflow orchestration. DDA execution is delegated to
  the bundled `dda-rs` sidecar; Python does not emulate missing native results.
- `backend/readers`: format-specific dataset readers behind one reader API.
- `backend/services`: explicit integrations such as ICA, NSG, and OpenNeuro.
- `domain`: transport-independent application data models.
- `persistence`: SQLite-backed workspace, annotation, and result state.
- `ui`: viewport-aware plot providers, render caches, Qt Quick scene-graph
  renderers, and QML components.
- `app/workbench`: the observable Python controller, asynchronous tasks, and
  models consumed by the QML application shell.

## Plot Data Flow

1. A reader loads only the requested channels and time window.
2. A plot provider converts that window or DDA matrix into viewport-sized
   geometry or tiles.
3. The Qt Quick bridge rasterizes viewport-sized waveform and line artifacts,
   caches them, and exposes those textures to QML.
4. QML composites waveform, heatmap, and line textures with cursors and
   annotations through the Qt scene graph.

The desktop runtime is QML-only. Python remains the authoritative state and
workflow layer; QML contains presentation and user-intent bindings only.
