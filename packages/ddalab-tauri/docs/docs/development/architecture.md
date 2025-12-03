---
sidebar_position: 1
---

# Architecture

DDALAB's technical architecture and design decisions.

## Overview

```
┌─────────────────────────────────────────────────┐
│                  DDALAB Desktop                  │
├─────────────────────────────────────────────────┤
│  Frontend (React + Next.js)                     │
│  ├── Components (UI, Features)                  │
│  ├── State Management (Zustand)                 │
│  └── Services (Tauri Bridge)                    │
├─────────────────────────────────────────────────┤
│  Backend (Rust + Tauri v2)                      │
│  ├── API Server (Axum)                          │
│  ├── File Readers/Writers                       │
│  ├── DDA Engine                                 │
│  └── Streaming Infrastructure                   │
└─────────────────────────────────────────────────┘
```

## Frontend

### Technology Stack

- **React 19** - UI framework
- **Next.js 16** - Full-stack framework
- **Tailwind CSS** - Styling
- **Radix UI** - Accessible primitives
- **Zustand** - State management
- **TanStack Query** - Data fetching

### Directory Structure

```
src/
├── app/           # Next.js app router
├── components/    # React components
│   ├── ui/        # Reusable primitives
│   └── [feature]/ # Feature components
├── hooks/         # Custom React hooks
├── services/      # API services
├── store/         # Zustand stores
└── types/         # TypeScript types
```

## Backend

### Technology Stack

- **Rust** - Systems programming
- **Tauri v2** - Desktop framework
- **Axum** - HTTP server
- **tokio** - Async runtime

### Module Structure

```
src-tauri/src/
├── api/           # HTTP handlers
├── file_readers/  # Format parsers
├── file_writers/  # Export writers
├── streaming/     # Real-time data
├── ica/           # ICA analysis
├── sync/          # Multi-device sync
└── tasks/         # Task management
```

## Data Flow

```
File → Reader → IntermediateData → DDA → Results → Export
                     ↓
              Visualization
```

## State Management

Using Zustand with Immer for immutable updates:

```typescript
const useAppStore = create<AppState>()(
  immer((set) => ({
    files: { loaded: [], current: null },
    dda: { config: defaultConfig, results: [] },
    // ...
  })),
);
```

## IPC Communication

Frontend ↔ Backend via Tauri invoke:

```typescript
// Frontend
const result = await invoke('run_dda_analysis', { config });

// Backend
#[tauri::command]
async fn run_dda_analysis(config: DdaConfig) -> Result<DdaResult, Error> {
    // ...
}
```
