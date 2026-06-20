# DDALAB GUI Refactor Goal

## Goal

Refactor `packages/ddalab` toward a simple, powerful, scalable desktop UI for high-sample-rate physiological data. The application should remain easy to install and maintain while supporting highly configurable custom components, responsive waveform inspection, DDA result visualization, and reproducible GUI/CLI workflows.

The preferred direction is to keep Qt as the desktop foundation, but move beyond the current QWidget/QPainter-heavy implementation for performance-critical visualization. The medium-term UI should migrate toward Qt Quick/QML for configurable interface components and a dedicated GPU/level-of-detail plotting layer for dense signal and DDA result rendering.

This is a staged refactor, not a full rewrite. The first priority is to isolate data access, plotting, and workflow orchestration so the current PySide6 app stays usable while high-density rendering and UI composition are replaced incrementally.

## Guiding Principles

- Keep the app workflow-first: data import, inspection, DDA configuration, execution, visualization, and export should stay tightly connected.
- Preserve the existing Python package and CLI surface unless there is a clear migration reason.
- Do not rewrite the full app before isolating the rendering and data-provider boundaries.
- Do not move to Go solely for performance; plotting scalability should come from tiled data, level-of-detail rendering, and GPU-backed visualization.
- Keep dda-rs as the computational backend and avoid duplicating DDA implementation logic in the GUI.
- Make performance measurable through explicit logging, frame timing, data-transfer timing, and render timing.

## Major Refactoring Steps

### 1. Separate Workflow State From Rendering

- Keep file selection, channel selection, DDA parameters, execution state, and export state in explicit Python-side models.
- Ensure GUI panels consume stable model/provider APIs rather than reaching into raw datasets or result objects directly.
- Preserve the shared GUI/CLI execution path so analyses started interactively can still be reproduced from exported commands.

### 2. Introduce a Plot Data Provider Layer

- Add a narrow internal API that serves viewport-aware display data.
- The UI should request channel range, time range, pixel width, plot layer, and desired representation.
- The provider should return display-ready waveform envelopes, matrix slices, heatmap tiles, line-plot series, annotations, and metadata.
- No visual component should need to know how the complete recording or DDA result is stored.

### 3. Replace QWidget Plot Hot Paths With a GPU-Capable Surface

- Treat high-density waveform and DDA result rendering as a dedicated subsystem.
- Keep the first implementation compatible with the current PySide6 app.
- Move toward Qt Quick scene graph, OpenGL/Vulkan-backed Qt rendering, VisPy, Datoviz, PyQtGraph, or a small Rust/C++ rendering component only behind a stable plotting interface.
- Avoid binding the workflow UI to one plotting engine until the provider and viewport contracts are stable.

### 4. Migrate the UI Shell Toward Qt Quick/QML

- Use Qt Quick/QML for configurable layouts, reusable controls, visual states, panels, theming, and custom UI components.
- Keep Python/PySide6 for orchestration during migration.
- Move one isolated screen or component at a time rather than replacing the full main window in one step.
- Keep QWidget fallbacks until the equivalent QML screen is verified.

### 5. Make Large-Recording Performance Measurable

- Add timing logs for data loading, slicing, downsampling, tile generation, GPU upload, render preparation, paint, and interaction latency.
- Include enough metadata in logs to identify file size, channel count, visible sample count, rendered primitive count, cache hits, and plot layer configuration.
- Treat slow interaction and slow render logs as acceptance checks for future plotting work.

## Short-Term Refactor

### Major Steps

#### Stabilize the Current Qt Widgets App

- Keep the current PySide6 app operational during the refactor.
- Avoid broad rewrites of application state, settings, NSG integration, and CLI wiring.
- Keep current workflows intact while replacing internals incrementally.
- Add regression tests or smoke tests around major GUI-visible workflows where practical.

#### Optimize Existing Plot Hot Paths

- Replace Python per-pixel heatmap loops with vectorized NumPy-to-QImage or equivalent buffer-based rendering.
- Ensure waveform rendering uses viewport-aware min/max envelope downsampling rather than plotting raw samples or naive point skipping.
- Cap rendered primitives by viewport size, not input sample count.
- Cache rendered tiles or pixmaps by data identity, visible range, channel set, scale, and color settings.
- Keep slow-paint logging and expand it to distinguish data preparation, rasterization, and paint time.

#### Introduce a Plot Data Provider Boundary

- Add the first small internal API separating plot widgets from raw datasets.
- Route existing waveform, heatmap, and DDA line plots through provider calls.
- Preserve existing QWidget visuals while changing where their data comes from.
- Add tests for viewport slicing, result matrix slicing, and cache-key behavior.

#### Clean Up UI Composition

- Break large UI classes into smaller workflow panels and reusable widgets.
- Keep channel selectors, file selectors, plot controls, DDA parameter forms, and export controls as independent components.
- Prefer declarative configuration objects for repeated UI patterns.
- Preserve simple Python control flow where it is clearer than abstraction.

### Minor Steps

- Add small, focused tests before touching plot-provider behavior.
- Keep feature flags for QML/GPU plot experiments while QWidget remains the fallback.
- Add structured log names for every expensive plot path.
- Keep GUI smoke tests runnable headlessly.
- Avoid speculative abstractions that do not directly support the QML or GPU rendering migration.

## Medium-Term Migration

### Major Steps

#### Move the UI Shell Toward Qt Quick/QML

- Use Qt Quick/QML for configurable custom components, theming, responsive layouts, and reusable workflow panels.
- Keep Python/PySide6 as the orchestration layer during migration.
- Migrate one screen or panel at a time, starting with isolated components rather than the entire main window.
- Keep the GUI and CLI execution path shared so interactive analyses remain reproducible.

#### Build a GPU-Backed Plotting Component

- Treat high-density plotting as a dedicated subsystem, not ordinary UI painting.
- Support waveform, heatmap, line plot, annotations, selections, and synchronized cursors through one rendering architecture.
- Use level-of-detail data from the plot provider instead of full-resolution arrays.
- Prefer a renderer that can support GPU acceleration through Qt Quick scene graph, VisPy, Datoviz, PyQtGraph, or a future native Rust/C++ component.
- Keep the renderer behind a narrow interface so the implementation can change without rewriting the workflow UI.

#### Add Multi-Resolution Data Structures

- Precompute or lazily build min/max signal pyramids for waveform display.
- Build DDA output tiles or matrix slices suitable for heatmap and line rendering.
- Keep cache invalidation explicit and tied to file identity, analysis parameters, channel selection, and time range.
- Make whole-file visualization fast enough that users do not need to manually crop before inspecting data.

#### Improve Configurability

- Introduce a small component registry for reusable panels, selectors, plot overlays, and export controls.
- Make plot layers configurable: raw waveform, selected channels, event markers, DDA heatmap, DDA line output, annotations, and export overlays.
- Store layouts, selected channels, time windows, plot settings, and analysis parameters as reproducible workspace state.

### Minor Steps

- Define QML component names and Python bridge objects consistently.
- Keep QML components thin; put expensive data work in providers or renderer backends.
- Add rendering benchmarks for representative large recordings and DDA outputs.
- Add cache-inspection logs for waveform pyramids and DDA tiles.
- Keep the QWidget implementation available until QML parity is proven for each migrated panel.

## Long-Term Direction

### Major Steps

#### Mature Qt Quick/QML Application Shell

- Use QML for the primary application layout, navigation, reusable controls, and visual theming.
- Keep Python for orchestration only where it remains productive.
- Move performance-sensitive rendering and data preparation into optimized Python/NumPy, Rust, C++, or GPU-backed components as needed.

#### Renderer Independence

- Keep the plotting subsystem replaceable.
- If Qt Quick scene graph is sufficient, continue there.
- If a dedicated renderer is needed, isolate it behind the same plot provider and viewport APIs.
- Avoid another full-stack rewrite unless the rendering boundary has already made migration low-risk.

#### Scalable Analysis Workspaces

- Support saved workspaces containing input files, channel selections, time ranges, DDA parameters, output paths, and visualization state.
- Support reproducible export from both GUI and CLI.
- Make large recordings navigable through progressive loading and cached display representations.

### Minor Steps

- Remove QWidget plot implementations only after QML/GPU equivalents are stable.
- Keep backwards-compatible workspace loading across UI migrations.
- Document renderer assumptions, cache formats, and provider contracts.
- Keep installer packaging simple: the app should ship with the needed runtime components and not require users to install a separate plotting stack manually.

## Non-Goals

- Do not rewrite the GUI in Go as the default path.
- Do not return to a webview-first architecture unless Qt cannot meet the UI and rendering requirements after the plotting layer is isolated.
- Do not bind the app to one plotting library before the plot provider API is stable.
- Do not duplicate dda-rs functionality in GUI code.
- Do not optimize by hiding data fidelity problems; downsampling must preserve visible extrema and support inspection-quality plots.

## Acceptance Criteria

- Opening and navigating large physiological recordings remains responsive.
- Whole-file waveform visualization is practical without manual pre-cropping.
- DDA heatmaps and line plots render through viewport-aware data slices or tiles.
- Slow rendering paths are visible in logs with enough detail to diagnose bottlenecks.
- Core GUI workflows remain backed by the same execution path as the CLI.
- The app has a clear migration path from QWidget-based panels to Qt Quick/QML components.
- The high-density plotting layer can be replaced or accelerated without rewriting the rest of the GUI.
