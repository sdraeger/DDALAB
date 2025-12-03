---
sidebar_position: 1
---

# API Reference Overview

DDALAB provides APIs at multiple levels for developers and researchers.

## API Layers

### TypeScript API

Frontend services and utilities for the React application.

**Key modules:**

- `tauriService` - Bridge to Rust backend
- `apiService` - HTTP API client
- `appStore` - Global state management

[View TypeScript API →](./typescript)

### Rust API

Backend implementation with native performance.

**Key modules:**

- `file_readers` - Multi-format file loading
- `file_writers` - Data export
- `api` - HTTP server handlers
- `streaming` - Real-time processing

[View Rust API →](./rust)

## Quick Reference

### Loading a File (TypeScript)

```typescript
import { TauriService } from "@/services/tauriService";

const fileInfo = await TauriService.loadFile("/path/to/file.edf");
console.log(fileInfo.channels);
```

### Running DDA Analysis (TypeScript)

```typescript
import { TauriService } from "@/services/tauriService";

const config = {
  embeddingDimension: 3,
  timeDelay: 1,
  deltaRange: { min: 1, max: 100, step: 1 },
  channels: ["Fp1", "Fp2", "F3", "F4"],
};

const results = await TauriService.runDDAAnalysis(config);
```

### File Reading (Rust)

```rust
use ddalab_tauri::file_readers::FileReaderFactory;
use std::path::Path;

let reader = FileReaderFactory::create_reader(Path::new("data.edf"))?;
let data = FileReaderFactory::to_intermediate_data(&*reader, None)?;
```

### File Writing (Rust)

```rust
use ddalab_tauri::file_writers::FileWriterFactory;
use std::path::Path;

FileWriterFactory::write_file(&data, Path::new("output.csv"), None)?;
```

## Documentation Generation

### TypeScript Docs

Generated with TypeDoc:

```bash
npm run docs:api
```

Output: `docs/api/` directory

### Rust Docs

Generated with rustdoc:

```bash
npm run docs:rust
```

Output: `src-tauri/target/doc/` directory

### Combined Docs

Generate all documentation:

```bash
npm run docs:all
```

## Type Definitions

### Core Types

```typescript
interface FileInfo {
  path: string;
  channels: ChannelInfo[];
  duration: number;
  sampleRate: number;
  format: FileFormat;
}

interface DDAConfig {
  embeddingDimension: number;
  timeDelay: number;
  deltaRange: DeltaRange;
  channels: string[];
}

interface DDAResult {
  channel: string;
  values: number[];
  statistics: Statistics;
}
```

### Rust Types

```rust
pub struct IntermediateData {
    pub metadata: DataMetadata,
    pub channels: Vec<ChannelData>,
}

pub struct DDAConfig {
    pub embedding_dimension: usize,
    pub time_delay: usize,
    pub delta_range: DeltaRange,
}
```

## Error Handling

### TypeScript

```typescript
try {
  const result = await TauriService.loadFile(path);
} catch (error) {
  if (error instanceof FileNotFoundError) {
    // Handle missing file
  } else if (error instanceof UnsupportedFormatError) {
    // Handle unsupported format
  }
}
```

### Rust

```rust
use anyhow::Result;

fn load_file(path: &Path) -> Result<IntermediateData> {
    let reader = FileReaderFactory::create_reader(path)
        .context("Failed to create reader")?;

    FileReaderFactory::to_intermediate_data(&*reader, None)
        .context("Failed to convert data")
}
```

## Best Practices

1. **Error Handling**: Always handle potential errors
2. **Type Safety**: Use TypeScript types for compile-time checks
3. **Async/Await**: Use async operations for file I/O
4. **Memory**: Stream large files when possible
5. **Cancellation**: Support task cancellation for long operations
