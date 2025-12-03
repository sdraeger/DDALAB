---
sidebar_position: 2
---

# TypeScript API

The TypeScript API provides services and utilities for the DDALAB frontend.

## Services

### TauriService

Bridge service for communicating with the Rust backend.

```typescript
import { TauriService } from "@/services/tauriService";
```

#### File Operations

```typescript
// Load a file
const fileInfo = await TauriService.loadFile(path: string);

// Get channel data
const data = await TauriService.getChannelData(
  filePath: string,
  channels: string[],
  startTime: number,
  endTime: number
);

// List supported formats
const formats = TauriService.getSupportedFormats();
```

#### DDA Analysis

```typescript
// Run analysis
const results = await TauriService.runDDAAnalysis(config: DDAConfig);

// Cancel running analysis
await TauriService.cancelAnalysis(jobId: string);

// Get analysis progress
const progress = await TauriService.getAnalysisProgress(jobId: string);
```

#### Preferences

```typescript
// Get preferences
const prefs = await TauriService.getAppPreferences();

// Save preferences
await TauriService.saveAppPreferences(prefs: AppPreferences);
```

### ApiService

HTTP API client for optional remote API connectivity.

```typescript
import { ApiService } from "@/services/apiService";
```

## State Management

### appStore

Zustand store for global application state.

```typescript
import { useAppStore } from '@/store/appStore';

// In a component
const { files, dda, settings } = useAppStore();

// Update state
useAppStore.setState({ ... });
```

#### State Structure

```typescript
interface AppState {
  files: {
    loaded: FileInfo[];
    current: FileInfo | null;
    isLoading: boolean;
  };
  dda: {
    config: DDAConfig;
    results: DDAResult[];
    isRunning: boolean;
    progress: number;
  };
  settings: AppPreferences;
  ui: {
    theme: "light" | "dark" | "system";
    sidebarOpen: boolean;
  };
}
```

## Hooks

### useBIDSQuery

Query hook for BIDS-formatted datasets.

```typescript
import { useBIDSQuery } from "@/hooks/useBIDSQuery";

const { data, isLoading, error } = useBIDSQuery({
  datasetPath: "/path/to/bids",
  subject: "sub-01",
});
```

### useStreamingData

Hook for real-time data streaming.

```typescript
import { useStreamingData } from "@/hooks/useStreamingData";

const { data, isConnected, start, stop } = useStreamingData({
  source: "lsl",
  channels: ["Fp1", "Fp2"],
});
```

## Types

### FileInfo

```typescript
interface FileInfo {
  path: string;
  name: string;
  format: FileFormat;
  channels: ChannelInfo[];
  duration: number;
  sampleRate: number;
  startTime: Date;
  metadata: Record<string, unknown>;
}
```

### ChannelInfo

```typescript
interface ChannelInfo {
  name: string;
  type: ChannelType;
  unit: string;
  sampleRate: number;
  physicalMin: number;
  physicalMax: number;
}
```

### DDAConfig

```typescript
interface DDAConfig {
  embeddingDimension: number;
  timeDelay: number;
  deltaRange: {
    min: number;
    max: number;
    step: number;
  };
  channels: string[];
  normalize: boolean;
  detrend: boolean;
}
```

### DDAResult

```typescript
interface DDAResult {
  channel: string;
  deltas: number[];
  values: number[];
  statistics: {
    mean: number;
    std: number;
    min: number;
    max: number;
  };
  computeTime: number;
}
```

## Utilities

### cn (classnames)

Merge Tailwind CSS classes.

```typescript
import { cn } from "@/lib/utils";

const className = cn("base-class", condition && "conditional-class", {
  "object-class": true,
});
```

## Full API Documentation

For complete API documentation, run:

```bash
npm run docs:api
```

This generates TypeDoc documentation in `docs/api/`.
