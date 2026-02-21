# DDALAB Tauri Application

Desktop application package for DDALAB, focused on practical analysis of
physiological recordings with Delay Differential Analysis (DDA).

## What this package provides

- Cross-platform desktop app (macOS, Windows, Linux) using Tauri + Next.js.
- Integrated DDA workflow for ST, CT, CD, DE, and SY variants.
- Local-first processing with native file access and persistent local state.
- Snapshot/reproducibility exports (`.ddalab`) and workflow recording/codegen.
- Result export pipeline (CSV/JSON/scripts/plot export/paper reproducibility
  bundle).

## Architecture (current)

- Frontend: Next.js + React + TypeScript.
- Desktop host: Tauri v2.
- Core compute + IO: Rust backend in `src-tauri`.
- Optional bridges for specific formats/streaming paths remain available where
  needed, but Rust/Tauri is the primary runtime architecture.

## Development

### Prerequisites

- Node.js 20+
- Bun
- Rust stable toolchain

### Install

```bash
bun install
```

### Run desktop app

```bash
bun run tauri:dev
```

### Run web-only UI

```bash
bun run dev
```

## Testing

### Type and lint

```bash
bun run typecheck
bun run lint
```

### Unit tests

```bash
bun run test:unit
```

### Rust tests

```bash
bun run test
```

### E2E tests

```bash
bun run test:e2e
```

## Build

```bash
bun run tauri:build
```

Artifacts are generated under:

`src-tauri/target/release/bundle/`

## Intended use

DDALAB is a research and translational analysis tool. It supports
reproducible review of physiological recordings but is not a standalone
clinical diagnostic system.
