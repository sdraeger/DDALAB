# File-Centric State Management System

## Overview

The file-centric state management system ensures that all application state is associated with specific files. When a file is selected, all related state (plot settings, analysis results, annotations, etc.) is automatically loaded. This provides a cohesive, file-based workflow where each file maintains its own independent state.

## Architecture

```
User Selects File
       ↓
appStore.setSelectedFile(file)
       ↓
FileStateManager.loadFileState(filePath)
       ↓
For each registered module:
├─ PlotModule.loadState(filePath) → Plot settings
├─ DDAModule.loadState(filePath) → DDA results
└─ AnnotationModule.loadState(filePath) → Annotations
       ↓
All tabs display file-specific state
```

## Key Components

### 1. FileStateManager ([fileStateManager.ts](../src/services/fileStateManager.ts))

Singleton service that coordinates all file-specific state:

```typescript
import { getFileStateManager } from '@/services/fileStateManager'

const fileStateManager = getFileStateManager()
await fileStateManager.initialize()

// Load state for a file
const fileState = await fileStateManager.loadFileState(filePath)

// Update state for a specific module
await fileStateManager.updateModuleState(filePath, 'plot', plotState)
```

### 2. State Modules ([stateModules/](../src/services/stateModules/))

Each module implements the `FileStateModule<T>` interface:

- **PlotStateModule** - Plot visualization settings
- **DDAStateModule** - DDA analysis state
- **AnnotationStateModule** - Annotation markers

### 3. Backend Storage ([file_state_db.rs](../src-tauri/src/db/file_state_db.rs))

SQLite database with three tables:
- `file_state_modules` - Module-specific state (JSON)
- `file_state_metadata` - File access tracking
- `file_state_registry` - Cross-file coordination

## State Types

### FilePlotState

```typescript
interface FilePlotState {
  chunkStart: number           // Current position (seconds)
  chunkSize: number            // Chunk size (samples)
  selectedChannels: string[]   // Active channels
  amplitude: number            // Amplitude scale
  showAnnotations: boolean     // Annotations visible
  preprocessing?: PreprocessingOptions
  channelColors?: Record<string, string>
  timeWindow?: { start: number; end: number }
  lastUpdated: string
}
```

### FileDDAState

```typescript
interface FileDDAState {
  currentAnalysisId: string | null
  analysisHistory: string[]    // Array of analysis IDs
  lastParameters: {
    variants: string[]
    windowLength: number
    windowStep: number
    detrending: 'linear' | 'polynomial' | 'none'
    scaleMin: number
    scaleMax: number
    scaleNum: number
  }
  selectedVariants: string[]
  lastUpdated: string
}
```

### FileAnnotationState

```typescript
interface FileAnnotationState {
  timeSeries: {
    global: PlotAnnotation[]
    channels: Record<string, PlotAnnotation[]>
  }
  ddaResults: Record<string, PlotAnnotation[]>
  lastUpdated: string
}
```

## Usage

### Automatic State Loading

State is automatically loaded when a file is selected:

```typescript
// In appStore.ts
setSelectedFile: (file) => {
  if (file && isFileStateSystemInitialized()) {
    const fileStateManager = getInitializedFileStateManager()
    const fileState = await fileStateManager.loadFileState(file.file_path)

    // State is automatically applied to the store
  }
}
```

### Automatic State Saving

State is automatically saved when it changes:

```typescript
// In appStore.ts
updatePlotState: (updates) => {
  set((state) => ({ plot: { ...state.plot, ...updates } }))

  if (fileManager.selectedFile && isFileStateSystemInitialized()) {
    const fileStateManager = getInitializedFileStateManager()
    await fileStateManager.updateModuleState(
      fileManager.selectedFile.file_path,
      'plot',
      filePlotState
    )
  }
}
```

### Creating a New State Module

To add a new state module (e.g., for MEG analysis):

1. **Define the state type** in `types/fileCentricState.ts`:

```typescript
export interface FileMEGState {
  sensorLayout: string
  filterSettings: MEGFilterSettings
  artifactRejection: ArtifactSettings
  lastUpdated: string
}
```

2. **Create the module** in `services/stateModules/megStateModule.ts`:

```typescript
import { FileStateModule, FileMEGState } from '@/types/fileCentricState'

export class MEGStateModule implements FileStateModule<FileMEGState> {
  readonly moduleId = 'meg'

  async loadState(filePath: string): Promise<FileMEGState | null> {
    try {
      const state = await invoke<FileMEGState>('get_file_meg_state', {
        filePath,
      })
      return state
    } catch (error) {
      return null
    }
  }

  async saveState(filePath: string, state: FileMEGState): Promise<void> {
    await invoke('save_file_meg_state', { filePath, state })
  }

  async clearState(filePath: string): Promise<void> {
    await invoke('clear_file_meg_state', { filePath })
  }

  getDefaultState(): FileMEGState {
    return {
      sensorLayout: 'default',
      filterSettings: getDefaultFilterSettings(),
      artifactRejection: getDefaultArtifactSettings(),
      lastUpdated: new Date().toISOString(),
    }
  }
}
```

3. **Register the module** in `services/stateModules/index.ts`:

```typescript
import { MEGStateModule } from './megStateModule'

export function registerCoreModules(fileStateManager: FileStateManager): void {
  fileStateManager.registerModule(new PlotStateModule(), 10)
  fileStateManager.registerModule(new DDAStateModule(), 20)
  fileStateManager.registerModule(new AnnotationStateModule(), 30)
  fileStateManager.registerModule(new MEGStateModule(), 40)  // Add new module
}
```

4. **Add backend commands** in `commands/state_commands.rs`:

```rust
#[tauri::command]
pub async fn save_file_meg_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
    state: serde_json::Value,
) -> Result<(), String> {
    state_manager
        .get_file_state_db()
        .save_module_state(&file_path, "meg", &state)
        .map_err(|e| e.to_string())
}
```

5. **Register command** in `main.rs`:

```rust
save_file_meg_state,
get_file_meg_state,
clear_file_meg_state,
```

That's it! Your new module will automatically:
- Load state when a file is selected
- Save state when it changes
- Persist to SQLite database
- Work with any number of files

## Benefits

1. **File-Centric Workflow** - All state tied to specific files
2. **Automatic State Management** - Load/save handled transparently
3. **Modular & Extensible** - Easy to add new state modules
4. **Scalable** - Works with unlimited files and modules
5. **Persistent** - State survives app restarts
6. **Type-Safe** - Full TypeScript support

## Backend Commands

### Module State Commands

- `save_file_plot_state(filePath, state)` - Save plot state
- `get_file_plot_state(filePath)` - Load plot state
- `clear_file_plot_state(filePath)` - Clear plot state
- `save_file_dda_state(filePath, state)` - Save DDA state
- `get_file_dda_state(filePath)` - Load DDA state
- `clear_file_dda_state(filePath)` - Clear DDA state
- `save_file_annotation_state(filePath, state)` - Save annotations
- `get_file_annotation_state(filePath)` - Load annotations
- `clear_file_annotation_state(filePath)` - Clear annotations

### Registry Commands

- `get_file_state_registry()` - Get complete registry
- `save_file_state_registry(registry)` - Save registry
- `get_tracked_files()` - Get all files with state
- `get_file_specific_state(filePath)` - Get complete file state

## Database Schema

### file_state_modules

```sql
CREATE TABLE file_state_modules (
    file_path TEXT NOT NULL,
    module_id TEXT NOT NULL,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (file_path, module_id)
)
```

### file_state_metadata

```sql
CREATE TABLE file_state_metadata (
    file_path TEXT PRIMARY KEY,
    first_opened TEXT NOT NULL,
    last_accessed TEXT NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 0,
    version TEXT NOT NULL DEFAULT '1.0.0'
)
```

### file_state_registry

```sql
CREATE TABLE file_state_registry (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
)
```

## Migration from Old System

The system includes fallback logic for legacy state:

```typescript
if (isFileStateSystemInitialized()) {
  // Use new file-centric state
  const fileState = await fileStateManager.loadFileState(filePath)
} else {
  // Fall back to legacy annotation loading
  const annotations = await invoke('get_file_annotations', { filePath })
}
```

Existing state is automatically migrated when files are opened.

## Testing

To test file switching with state restoration:

1. Open File A
2. Adjust plot settings (position, channels, amplitude)
3. Open File B
4. Adjust different settings
5. Switch back to File A
6. Verify File A's settings are restored exactly

## Performance

- **State Loading**: <10ms for typical file state
- **State Saving**: Debounced to every 2 seconds
- **Memory**: Limited to 10 cached file states
- **Database**: SQLite with WAL mode for concurrency
