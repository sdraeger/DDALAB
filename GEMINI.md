# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Always ask before you create summary documents.

For state management in Tauri+NextJS, ALWAYS use efficient state updates in Zustand by only updating necessary props, and use the Immer library.

## Package Manager

**Always use `bun` instead of `npm`.** This project uses bun as the package manager for faster installs and better performance. Use `bun run`, `bun install`, and `bunx` instead of their npm equivalents.

## Code Style

Always write code by the SOLID principles of Software Engineering. Always write modular and maintainable code. Avoid redefinitions of constants.

## Project Overview

DDALAB (Delay Differential Analysis Laboratory) is a scientific computing desktop application for performing Delay Differential Analysis on neurophysiology data files. The architecture consists of:

- **Rust backend** via Tauri v2
- **Next.js frontend** with React 19
- **Optional institutional server** for multi-user deployments

## Monorepo Structure

```
packages/
├── ddalab-tauri/     # Main desktop application (Next.js + Tauri)
├── dda-rs/           # Rust library for DDA binary interface
├── dda-py/           # Python bindings for DDA
├── dda-codegen/      # Code generator from DDA_SPEC.yaml
└── ddalab-server/    # Institutional server for multi-user sync
```

## Common Development Commands

### Desktop Application (ddalab-tauri)

```bash
cd packages/ddalab-tauri

# Development
bun run dev              # Next.js dev server (port 3003)
bun run tauri:dev        # Full Tauri development mode

# Build
bun run build            # Next.js production build
bun run tauri:build      # Full desktop app build
bun run release:mac      # Universal macOS binary

# Code Quality
bun run fmt              # Format (Prettier + cargo fmt)
bun run typecheck        # TypeScript type checking
bun run lint             # ESLint
bun run test             # Rust tests (cargo test)

# Documentation
bun run storybook        # Component storybook (port 6006)
bun run docs:build       # Build all documentation
```

### Root Level Commands

```bash
bun run dev              # Turbo dev (all packages)
bun run build            # Turbo build (all packages)
bun run codegen          # Generate code from DDA_SPEC.yaml
bun run codegen:check    # Generate and verify no drift
```

### Rust Commands

```bash
# In packages/ddalab-tauri/src-tauri
cargo test               # Run Rust tests
cargo fmt --all          # Format Rust code
cargo clippy             # Lint Rust code
cargo doc --no-deps      # Generate Rust docs
```

## Git Hooks

A pre-commit hook is configured at `.git/hooks/pre-commit` that:

1. Runs `bun run fmt` in packages/ddalab-tauri (Prettier + cargo fmt)
2. Auto-stages any files modified by formatting
3. Runs `bun run typecheck` to verify TypeScript compiles

## State Management Architecture

- **Zustand + Immer** for all frontend state
- ALWAYS use efficient state updates—only update the props that need updating
- Use Immer's `produce` for immutable updates

## Frontend Architecture

### Technology Stack

- Next.js 16 with Turbopack
- React 19
- Tauri v2 for desktop integration
- Radix UI for accessible components
- TailwindCSS for styling
- TanStack Query for async state
- uPlot/ECharts for visualization

### Key Directories

```
packages/ddalab-tauri/src/
├── app/              # Next.js app router pages
├── components/       # React components (~60+ components)
├── hooks/            # Custom React hooks
├── store/            # Zustand stores
├── services/         # API/Tauri service layer
├── types/            # TypeScript type definitions
└── utils/            # Utility functions
```

### Component Patterns

- Use Radix UI primitives consistently
- Follow existing patterns in neighboring files
- Widget components in `components/widgets/`
- React Grid Layout for drag-and-drop dashboard

### Mounted View Pattern (Critical)

**NEVER use conditional rendering for navigation or file-dependent content.** Conditional rendering (`{condition ? <A /> : <B />}`) causes components to unmount and lose their state (chart instances, scroll positions, form values).

Instead, use the **MountedView** and **FileGatedContent** patterns from `NavigationContent.tsx`:

```tsx
// BAD - causes remounting and state loss
{
  hasFile ? <HeavyComponent /> : <EmptyState />;
}

// GOOD - keeps both mounted, controls visibility with CSS
<FileGatedContent
  hasFile={hasFile}
  emptyIcon={Icon}
  emptyTitle="..."
  emptyDescription="..."
>
  <HeavyComponent />
</FileGatedContent>;
```

Key principles:

- Use `display: none` / `visibility: hidden` instead of conditional rendering
- Set `aria-hidden` and `inert` on hidden content for accessibility
- Use `lazyMount` to defer initial render until first activation
- Lift ephemeral UI state (like tab selections) to Zustand if it should persist across remounts

## Backend Architecture (Rust/Tauri)

### Key Directories

```
packages/ddalab-tauri/src-tauri/src/
├── api/              # Embedded API handlers
├── commands/         # Tauri commands (IPC)
├── db/               # SQLite database layer
├── file_readers/     # Neurophysiology file format readers
├── file_writers/     # Export format writers
├── streaming/        # Real-time data streaming
├── sync/             # Institutional sync client
├── nsg/              # NSG (Neuroscience Gateway) integration
└── ica/              # ICA processing
```

## File Format Support

### Supported Input Formats

| Format      | Extension        | Description                                                             |
| ----------- | ---------------- | ----------------------------------------------------------------------- |
| EDF/EDF+    | .edf             | European Data Format (clinical EEG standard)                            |
| BrainVision | .vhdr/.vmrk/.eeg | BrainProducts format                                                    |
| EEGLAB      | .set             | MATLAB-based EEGLAB format                                              |
| FIF/FIFF    | .fif             | Neuromag/Elekta MEG format                                              |
| NIfTI       | .nii/.nii.gz     | Neuroimaging format                                                     |
| XDF         | .xdf             | Lab Streaming Layer recordings                                          |
| CSV/ASCII   | .csv/.txt        | Custom text formats                                                     |
| NWB         | .nwb             | Neurodata Without Borders (optional, requires `--features nwb-support`) |

### Supported Export Formats

- EDF, CSV, ASCII, XDF (always available)
- NWB (requires `--features nwb-support`)

### File Reader/Writer Architecture

All readers convert to `IntermediateData` format:

```rust
pub struct IntermediateData {
    pub metadata: DataMetadata,
    pub channels: Vec<ChannelData>,
}
```

Pipeline: `File → FileReader → IntermediateData → DDA/Visualization → FileWriter → Export`

### Adding New File Formats

1. Create reader in `src-tauri/src/file_readers/`
2. Implement the `FileReader` trait
3. Register in `FileReaderFactory::create_reader()`
4. Add extension to `supported_extensions()`

## Code Generation

DDALAB uses `dda-spec` to generate consistent code from smithy specifications using tera templates:

```bash
bun run codegen           # Generate for all languages
bun run codegen:check     # Verify generated code is up-to-date
bun run codegen:dry-run   # Preview changes without writing
```

Generated code locations:

- Rust: `packages/ddalab-tauri/src-tauri/src/` (variant metadata)
- Python: `packages/dda-py/src/`
- TypeScript: `packages/ddalab-tauri/src/`

## Institutional Server (ddalab-server)

For multi-user deployments on local networks:

```bash
cd packages/ddalab-server
docker-compose up -d      # Start server with PostgreSQL
```

Features:

- Multi-user support with peer-to-peer result sharing
- mDNS automatic discovery on local network
- Application-layer AES-256-GCM encryption
- HIPAA compliant (data stays on local network)

## Development Workflow

### Adding New Features

1. Frontend changes: Work in `packages/ddalab-tauri/src/`
2. Backend changes: Work in `packages/ddalab-tauri/src-tauri/src/`
3. Run `bun run fmt` and `bun run typecheck` before committing
4. Run `cargo test` for Rust changes
5. Use feature branches and PRs

### Testing

- Frontend: Storybook for component testing
- Backend: `cargo test` for Rust unit tests
- Integration: Manual testing via `bun run tauri:dev`

## Important Conventions

### Code Style

- TypeScript for all frontend code
- Rust for backend/file readers
- Follow existing patterns in neighboring files
- Use Radix UI components consistently
- No comments unless specifically requested

### File Naming

- React components: `PascalCase.tsx`
- Utilities: `camelCase.ts`
- Rust modules: `snake_case.rs`
- Test files: `*.test.ts` or `test_*.rs`

### Security

- Never commit secrets or credentials
- All processing happens locally by default
- Institutional server uses encryption for network traffic

## Critical Notes

1. **State Management**: Use Zustand + Immer; do not introduce other state libraries
2. **Mounted Views**: NEVER use conditional rendering for views—use MountedView/FileGatedContent patterns to preserve component state
3. **Data Privacy**: All processing is local by default
4. **Scientific Accuracy**: DDA algorithms are core—test thoroughly
5. **File Format Support**: NWB requires `--features nwb-support` due to HDF5 dependencies
6. **Pre-commit Hook**: Formatting and typecheck run automatically on commit
