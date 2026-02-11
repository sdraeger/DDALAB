# Interactive Tutorials & Paper Reproduction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Learn" primary navigation tab with interactive tutorials, downloadable sample datasets, and paper reproduction recipes, plus quick-access cards on the Overview dashboard.

**Architecture:** New `learn` primary nav tab with three secondary views (tutorials, sample-data, papers). TypeScript tutorial definitions for UI-coupled walkthroughs. Remote JSON registries (GitHub) for sample data and paper recipes. Tauri commands for downloading/caching data to `~/.ddalab/sample-data/`. Zustand slice for progress tracking.

**Tech Stack:** React 19, Zustand + Immer, TanStack Query, Tauri v2 IPC, Radix UI, TailwindCSS

**Design Doc:** `docs/plans/2026-02-09-interactive-tutorials-design.md`

---

## Task 1: Add TypeScript types for tutorials, sample data, and paper recipes

**Files:**
- Create: `packages/ddalab-tauri/src/types/learn.ts`

**Step 1: Create the types file**

```typescript
// packages/ddalab-tauri/src/types/learn.ts

// ============================================================================
// Tutorial Types
// ============================================================================

export type TutorialStepType = "narrative" | "action" | "highlight" | "auto";

export interface TutorialStep {
  id: string;
  type: TutorialStepType;
  title: string;
  /** Markdown content for narrative steps */
  content?: string;
  /** CSS selector for highlight/action steps (uses data-tour attributes) */
  target?: string;
  /** Description of what the user should do (action steps) */
  actionDescription?: string;
  /** Store predicate to detect action completion — key path and expected value */
  completionCheck?: {
    storeKey: string;
    expectedValue: unknown;
  };
  /** For auto steps: action to dispatch */
  autoAction?: {
    type: string;
    payload?: Record<string, unknown>;
  };
}

export interface TutorialDefinition {
  id: string;
  title: string;
  description: string;
  icon: string;
  estimatedMinutes: number;
  steps: TutorialStep[];
  /** Sample dataset ID required for this tutorial (downloaded if needed) */
  requiredDataset?: string;
}

export interface TutorialProgress {
  currentStep: number;
  completed: boolean;
  lastAccessedAt: number;
}

// ============================================================================
// Sample Data Types
// ============================================================================

export interface SampleDataset {
  id: string;
  name: string;
  description: string;
  format: string;
  sizeBytes: number;
  url: string;
  channels: number;
  duration: string;
  sampleRate: number;
}

export interface SampleDataIndex {
  version: string;
  datasets: SampleDataset[];
}

export interface SampleDataStatus {
  downloaded: boolean;
  path: string | null;
  downloading: boolean;
  progress: number;
}

// ============================================================================
// Paper Recipe Types
// ============================================================================

export interface PaperCitation {
  authors: string;
  title: string;
  journal: string;
  year: number;
  doi?: string;
}

export interface PaperRecipeSteps {
  channels?: string[];
  variant?: string;
  parameters?: {
    tau?: number[];
    windowLength?: number;
    overlap?: number;
  };
  referenceResults?: {
    description: string;
  };
}

export interface PaperRecipe {
  id: string;
  citation: PaperCitation;
  description: string;
  dataset: {
    source: "sample-data" | "openneuro";
    id: string;
  };
  steps: PaperRecipeSteps;
}

export interface PaperRecipeIndex {
  version: string;
  recipes: PaperRecipe[];
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: PASS (new file, no imports yet)

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/types/learn.ts
git commit -m "feat(learn): add TypeScript types for tutorials, sample data, and paper recipes"
```

---

## Task 2: Add "learn" to navigation config

**Files:**
- Modify: `packages/ddalab-tauri/src/types/navigation.ts`

**Step 1: Add learn tab to PrimaryNavTab type**

At line 1, add `"learn"` to the union:

```typescript
export type PrimaryNavTab =
  | "overview"
  | "explore"
  | "analyze"
  | "data"
  | "learn"        // <-- ADD
  | "plugins"
  | "collaborate"
  | "settings"
  | "notifications";
```

**Step 2: Add learn secondary tabs to SecondaryNavTab type**

After `| "gallery";` (line 30), add:

```typescript
  // Learn tabs
  | "tutorials"
  | "sample-data"
  | "papers";
```

**Step 3: Add learn entry to navigationConfig**

After the `data` entry (line 76) and before `plugins`, add:

```typescript
  learn: {
    id: "learn",
    label: "Learn",
    icon: "GraduationCap",
    description: "Tutorials, sample data, and paper reproductions",
    secondaryTabs: ["tutorials", "sample-data", "papers"],
  },
```

**Step 4: Add learn secondary tab configs to secondaryTabConfig**

After the `"nsg-jobs"` entry (line 201) and before the `// Collaborate` comment, add:

```typescript
  // Learn
  tutorials: {
    id: "tutorials",
    label: "Tutorials",
    icon: "BookOpen",
    description: "Interactive step-by-step guides",
  },
  "sample-data": {
    id: "sample-data",
    label: "Sample Data",
    icon: "Download",
    description: "Download example datasets",
  },
  papers: {
    id: "papers",
    label: "Papers",
    icon: "FileSearch",
    description: "Reproduce results from published papers",
  },
```

**Step 5: Verify TypeScript compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/ddalab-tauri/src/types/navigation.ts
git commit -m "feat(learn): add Learn tab with tutorials, sample-data, papers secondary tabs"
```

---

## Task 3: Create the learn Zustand slice

**Files:**
- Create: `packages/ddalab-tauri/src/store/slices/learnSlice.ts`
- Modify: `packages/ddalab-tauri/src/store/slices/types.ts`
- Modify: `packages/ddalab-tauri/src/store/slices/index.ts`
- Modify: `packages/ddalab-tauri/src/store/appStore.ts`

**Step 1: Create the slice file**

```typescript
// packages/ddalab-tauri/src/store/slices/learnSlice.ts
import type {
  TutorialProgress,
  SampleDataStatus,
  PaperRecipe,
  SampleDataset,
} from "@/types/learn";
import type { ImmerStateCreator } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface LearnState {
  tutorialProgress: Record<string, TutorialProgress>;
  sampleDatasets: Record<string, SampleDataStatus>;
  sampleDataIndex: SampleDataset[] | null;
  recipesIndex: PaperRecipe[] | null;
  activeTutorialId: string | null;
  activeRecipeId: string | null;
}

export interface LearnActions {
  setTutorialProgress: (tutorialId: string, progress: TutorialProgress) => void;
  clearTutorialProgress: (tutorialId: string) => void;
  setSampleDataStatus: (datasetId: string, status: Partial<SampleDataStatus>) => void;
  setSampleDataIndex: (datasets: SampleDataset[]) => void;
  setRecipesIndex: (recipes: PaperRecipe[]) => void;
  setActiveTutorialId: (id: string | null) => void;
  setActiveRecipeId: (id: string | null) => void;
}

export interface LearnSlice extends LearnActions {
  learn: LearnState;
}

// ============================================================================
// Default State
// ============================================================================

export const defaultLearnState: LearnState = {
  tutorialProgress: {},
  sampleDatasets: {},
  sampleDataIndex: null,
  recipesIndex: null,
  activeTutorialId: null,
  activeRecipeId: null,
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createLearnSlice: ImmerStateCreator<LearnSlice> = (set) => ({
  learn: defaultLearnState,

  setTutorialProgress: (tutorialId, progress) =>
    set((state) => {
      state.learn.tutorialProgress[tutorialId] = progress;
    }),

  clearTutorialProgress: (tutorialId) =>
    set((state) => {
      delete state.learn.tutorialProgress[tutorialId];
    }),

  setSampleDataStatus: (datasetId, status) =>
    set((state) => {
      const current = state.learn.sampleDatasets[datasetId] ?? {
        downloaded: false,
        path: null,
        downloading: false,
        progress: 0,
      };
      state.learn.sampleDatasets[datasetId] = { ...current, ...status };
    }),

  setSampleDataIndex: (datasets) =>
    set((state) => {
      state.learn.sampleDataIndex = datasets;
    }),

  setRecipesIndex: (recipes) =>
    set((state) => {
      state.learn.recipesIndex = recipes;
    }),

  setActiveTutorialId: (id) =>
    set((state) => {
      state.learn.activeTutorialId = id;
    }),

  setActiveRecipeId: (id) =>
    set((state) => {
      state.learn.activeRecipeId = id;
    }),
});
```

**Step 2: Add LearnSlice to AppState in types.ts**

In `packages/ddalab-tauri/src/store/slices/types.ts`:

Add import at top (after line 35):
```typescript
import type { LearnSlice } from "./learnSlice";
```

Add `LearnSlice` to the AppState union (after `GallerySlice &` on line 413):
```typescript
  LearnSlice &
```

**Step 3: Export from index.ts**

In `packages/ddalab-tauri/src/store/slices/index.ts`, after line 66:

```typescript
export { createLearnSlice, defaultLearnState } from "./learnSlice";
export type { LearnState, LearnSlice } from "./learnSlice";
```

**Step 4: Wire into appStore.ts**

In `packages/ddalab-tauri/src/store/appStore.ts`:

Add import (after line 28):
```typescript
import { createLearnSlice } from "./slices/learnSlice";
```

Add type re-export (after line 71):
```typescript
export type { LearnState } from "./slices/learnSlice";
```

Add to store creation (after line 98):
```typescript
    ...createLearnSlice(set, get, store),
```

**Step 5: Verify TypeScript compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/ddalab-tauri/src/store/slices/learnSlice.ts \
  packages/ddalab-tauri/src/store/slices/types.ts \
  packages/ddalab-tauri/src/store/slices/index.ts \
  packages/ddalab-tauri/src/store/appStore.ts
git commit -m "feat(learn): add Zustand learn slice for tutorial and sample data state"
```

---

## Task 4: Create Tauri backend commands for sample data management

**Files:**
- Create: `packages/ddalab-tauri/src-tauri/src/commands/learn_commands.rs`
- Modify: `packages/ddalab-tauri/src-tauri/src/commands/mod.rs`
- Modify: `packages/ddalab-tauri/src-tauri/src/main.rs`

**Step 1: Create learn_commands.rs**

```rust
// packages/ddalab-tauri/src-tauri/src/commands/learn_commands.rs
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

/// Get the platform-specific sample data directory (~/.ddalab/sample-data/)
fn sample_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let dir = home.join(".ddalab").join("sample-data");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create sample data directory: {e}"))?;
    Ok(dir)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedDataset {
    pub id: String,
    pub path: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub async fn get_sample_data_dir() -> Result<String, String> {
    let dir = sample_data_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn list_downloaded_samples() -> Result<Vec<DownloadedDataset>, String> {
    let dir = sample_data_dir()?;
    let mut datasets = Vec::new();

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read sample data directory: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                let size = std::fs::metadata(&path)
                    .map(|m| m.len())
                    .unwrap_or(0);
                datasets.push(DownloadedDataset {
                    id: stem.to_string(),
                    path: path.to_string_lossy().to_string(),
                    size_bytes: size,
                });
            }
        }
    }

    Ok(datasets)
}

#[tauri::command]
pub async fn download_sample_data(
    app: tauri::AppHandle,
    url: String,
    dataset_id: String,
    file_extension: String,
) -> Result<String, String> {
    let dir = sample_data_dir()?;
    let filename = format!("{}.{}", dataset_id, file_extension);
    let dest = dir.join(&filename);

    // If already downloaded, return existing path
    if dest.exists() {
        return Ok(dest.to_string_lossy().to_string());
    }

    // Download using reqwest
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    std::fs::write(&dest, &bytes)
        .map_err(|e| format!("Failed to write file: {e}"))?;

    log::info!(
        "Downloaded sample dataset '{}' ({} bytes) to {}",
        dataset_id,
        bytes.len(),
        dest.display()
    );

    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_sample_data(dataset_id: String) -> Result<(), String> {
    let dir = sample_data_dir()?;

    // Find and delete any file matching the dataset_id stem
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read sample data directory: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            if stem == dataset_id {
                std::fs::remove_file(&path)
                    .map_err(|e| format!("Failed to delete {}: {e}", path.display()))?;
                log::info!("Deleted sample dataset '{}'", dataset_id);
                return Ok(());
            }
        }
    }

    Err(format!("Dataset '{}' not found", dataset_id))
}

#[tauri::command]
pub async fn fetch_remote_index(url: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch index: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Fetch failed with status: {}", response.status()));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    Ok(body)
}
```

**Step 2: Register in mod.rs**

In `packages/ddalab-tauri/src-tauri/src/commands/mod.rs`, add after `pub mod gallery_commands;` (line 14):

```rust
pub mod learn_commands; // Tutorial & sample data management
```

Add after `pub use gallery_commands::*;` (line 45):

```rust
pub use learn_commands::*;
```

**Step 3: Register in main.rs invoke_handler**

In `packages/ddalab-tauri/src-tauri/src/main.rs`, add to the `tauri::generate_handler!` macro (find a logical spot, e.g., after gallery commands):

```rust
            // Learn/Tutorial commands
            get_sample_data_dir,
            list_downloaded_samples,
            download_sample_data,
            delete_sample_data,
            fetch_remote_index,
```

**Step 4: Verify Rust compiles**

Run: `cd packages/ddalab-tauri/src-tauri && cargo check`
Expected: PASS (warnings OK)

**Step 5: Commit**

```bash
git add packages/ddalab-tauri/src-tauri/src/commands/learn_commands.rs \
  packages/ddalab-tauri/src-tauri/src/commands/mod.rs \
  packages/ddalab-tauri/src-tauri/src/main.rs
git commit -m "feat(learn): add Tauri commands for sample data download and remote index fetch"
```

---

## Task 5: Create frontend service methods and TanStack Query hooks

**Files:**
- Modify: `packages/ddalab-tauri/src/services/tauriService.ts`
- Create: `packages/ddalab-tauri/src/hooks/useLearn.ts`

**Step 1: Add service methods to TauriService**

In `packages/ddalab-tauri/src/services/tauriService.ts`, after the Python/MNE section (before `// Git-annex support`), add:

```typescript
  // Learn / Tutorial Commands
  static async getSampleDataDir(): Promise<string> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("get_sample_data_dir");
  }

  static async listDownloadedSamples(): Promise<
    { id: string; path: string; sizeBytes: number }[]
  > {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("list_downloaded_samples");
  }

  static async downloadSampleData(
    url: string,
    datasetId: string,
    fileExtension: string,
  ): Promise<string> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("download_sample_data", {
      url,
      datasetId,
      fileExtension,
    });
  }

  static async deleteSampleData(datasetId: string): Promise<void> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("delete_sample_data", { datasetId });
  }

  static async fetchRemoteIndex(url: string): Promise<string> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("fetch_remote_index", { url });
  }
```

**Step 2: Create the useLearn hook**

```typescript
// packages/ddalab-tauri/src/hooks/useLearn.ts
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TauriService } from "@/services/tauriService";
import type {
  SampleDataIndex,
  PaperRecipeIndex,
  SampleDataset,
} from "@/types/learn";
import { useAppStore } from "@/store/appStore";

const SAMPLE_DATA_INDEX_URL =
  "https://raw.githubusercontent.com/sdraeger/ddalab-data/main/sample-data-index.json";
const RECIPES_INDEX_URL =
  "https://raw.githubusercontent.com/sdraeger/ddalab-data/main/recipes-index.json";

export const learnKeys = {
  all: ["learn"] as const,
  sampleIndex: () => [...learnKeys.all, "sample-index"] as const,
  recipesIndex: () => [...learnKeys.all, "recipes-index"] as const,
  downloadedSamples: () => [...learnKeys.all, "downloaded"] as const,
};

export function useSampleDataIndex() {
  const setSampleDataIndex = useAppStore((s) => s.setSampleDataIndex);

  return useQuery({
    queryKey: learnKeys.sampleIndex(),
    queryFn: async () => {
      const raw = await TauriService.fetchRemoteIndex(SAMPLE_DATA_INDEX_URL);
      const index: SampleDataIndex = JSON.parse(raw);
      setSampleDataIndex(index.datasets);
      return index.datasets;
    },
    staleTime: 5 * 60_000,
  });
}

export function usePaperRecipesIndex() {
  const setRecipesIndex = useAppStore((s) => s.setRecipesIndex);

  return useQuery({
    queryKey: learnKeys.recipesIndex(),
    queryFn: async () => {
      const raw = await TauriService.fetchRemoteIndex(RECIPES_INDEX_URL);
      const index: PaperRecipeIndex = JSON.parse(raw);
      setRecipesIndex(index.recipes);
      return index.recipes;
    },
    staleTime: 5 * 60_000,
  });
}

export function useDownloadedSamples() {
  return useQuery({
    queryKey: learnKeys.downloadedSamples(),
    queryFn: () => TauriService.listDownloadedSamples(),
    staleTime: 30_000,
  });
}

export function useDownloadSampleData() {
  const queryClient = useQueryClient();
  const setSampleDataStatus = useAppStore((s) => s.setSampleDataStatus);

  return useMutation({
    mutationFn: async (dataset: SampleDataset) => {
      const ext = dataset.format.toLowerCase();
      setSampleDataStatus(dataset.id, { downloading: true, progress: 0 });
      const path = await TauriService.downloadSampleData(
        dataset.url,
        dataset.id,
        ext,
      );
      return { id: dataset.id, path };
    },
    onSuccess: ({ id, path }) => {
      setSampleDataStatus(id, {
        downloaded: true,
        path,
        downloading: false,
        progress: 100,
      });
      queryClient.invalidateQueries({ queryKey: learnKeys.downloadedSamples() });
    },
    onError: (_err, dataset) => {
      setSampleDataStatus(dataset.id, { downloading: false, progress: 0 });
    },
  });
}

export function useDeleteSampleData() {
  const queryClient = useQueryClient();
  const setSampleDataStatus = useAppStore((s) => s.setSampleDataStatus);

  return useMutation({
    mutationFn: (datasetId: string) => TauriService.deleteSampleData(datasetId),
    onSuccess: (_data, datasetId) => {
      setSampleDataStatus(datasetId, {
        downloaded: false,
        path: null,
        downloading: false,
        progress: 0,
      });
      queryClient.invalidateQueries({ queryKey: learnKeys.downloadedSamples() });
    },
  });
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/ddalab-tauri/src/services/tauriService.ts \
  packages/ddalab-tauri/src/hooks/useLearn.ts
git commit -m "feat(learn): add Tauri service methods and TanStack Query hooks for learn features"
```

---

## Task 6: Define initial tutorial set

**Files:**
- Create: `packages/ddalab-tauri/src/data/tutorials.ts`

**Step 1: Create the tutorials data file**

```typescript
// packages/ddalab-tauri/src/data/tutorials.ts
import type { TutorialDefinition } from "@/types/learn";

export const tutorials: TutorialDefinition[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    description:
      "Learn the basics: open a file, explore channels, and navigate the time series view.",
    icon: "Rocket",
    estimatedMinutes: 5,
    requiredDataset: "eeg-sample-rest",
    steps: [
      {
        id: "welcome",
        type: "narrative",
        title: "Welcome to DDALAB",
        content:
          "DDALAB is a desktop application for Delay Differential Analysis of neurophysiology data. In this tutorial, you'll learn how to open a data file and explore its contents.\n\nLet's start by downloading a sample dataset.",
      },
      {
        id: "navigate-learn",
        type: "highlight",
        title: "Sample Data",
        target: "[data-nav='learn']",
        content:
          "You're in the Learn tab. If you haven't already, switch to the **Sample Data** sub-tab to download example datasets.",
      },
      {
        id: "open-file",
        type: "action",
        title: "Open the Sample File",
        actionDescription:
          "In the file sidebar, navigate to the downloaded sample dataset and click on it to open.",
        completionCheck: {
          storeKey: "fileManager.selectedFile",
          expectedValue: "non-null",
        },
      },
      {
        id: "explore-channels",
        type: "highlight",
        title: "Channel List",
        target: "[data-tour='file-manager']",
        content:
          "The sidebar shows all channels in the file. Each channel represents an electrode or sensor. You can select/deselect channels to control which ones are displayed.",
      },
      {
        id: "view-timeseries",
        type: "auto",
        title: "Navigate to Time Series",
        autoAction: {
          type: "navigate",
          payload: { primary: "explore", secondary: "timeseries" },
        },
      },
      {
        id: "timeseries-overview",
        type: "narrative",
        title: "Time Series View",
        content:
          "The time series view shows the raw signal data over time. You can:\n\n- **Scroll** horizontally to navigate through the recording\n- **Zoom** with the mouse wheel to see more or less detail\n- **Select channels** from the sidebar to add/remove traces\n\nTry scrolling and zooming to explore the data!",
      },
      {
        id: "complete",
        type: "narrative",
        title: "Tutorial Complete!",
        content:
          "You've learned the basics of opening and exploring data in DDALAB. Next, try the **Your First DDA Analysis** tutorial to learn about running Delay Differential Analysis.",
      },
    ],
  },
  {
    id: "first-dda-analysis",
    title: "Your First DDA Analysis",
    description:
      "Configure DDA parameters, run an analysis, and interpret the results heatmap.",
    icon: "Brain",
    estimatedMinutes: 10,
    requiredDataset: "eeg-sample-rest",
    steps: [
      {
        id: "intro",
        type: "narrative",
        title: "What is DDA?",
        content:
          "Delay Differential Analysis (DDA) fits delay differential equation models to time series data. The resulting coefficients reveal the underlying dynamics of the signal.\n\nIn this tutorial, you'll run a DDA analysis on sample EEG data and learn to interpret the results.",
      },
      {
        id: "nav-to-dda",
        type: "auto",
        title: "Navigate to DDA",
        autoAction: {
          type: "navigate",
          payload: { primary: "analyze", secondary: "dda" },
        },
      },
      {
        id: "select-channels",
        type: "action",
        title: "Select Channels",
        actionDescription:
          "Select 3-5 channels for analysis (e.g., Fz, Cz, Pz, O1, O2). Fewer channels means faster analysis for this tutorial.",
      },
      {
        id: "configure-params",
        type: "highlight",
        title: "DDA Parameters",
        target: "[data-tour='analysis-config']",
        content:
          "The analysis configuration panel lets you set:\n\n- **Variants**: Which DDA models to fit (DDA1-DDA9)\n- **Window Length**: How many seconds per analysis window\n- **Delays**: The time delays (tau values) to test\n\nThe defaults are a good starting point. Click **Run Analysis** when ready.",
      },
      {
        id: "run-analysis",
        type: "action",
        title: "Run the Analysis",
        actionDescription: "Click the Run Analysis button to start the DDA computation.",
        target: "#dda-run-button",
        completionCheck: {
          storeKey: "dda.currentAnalysis",
          expectedValue: "non-null",
        },
      },
      {
        id: "interpret-results",
        type: "narrative",
        title: "Interpreting Results",
        content:
          "The heatmap shows DDA coefficients across channels and time windows:\n\n- **X-axis**: Time windows across the recording\n- **Y-axis**: DDA model coefficients\n- **Color**: Coefficient magnitude (brighter = stronger)\n\nLook for patterns: consistent bands indicate stable dynamics, while changes across time may indicate state transitions.",
      },
      {
        id: "complete",
        type: "narrative",
        title: "Analysis Complete!",
        content:
          "Congratulations! You've run your first DDA analysis. Explore the results by hovering over the heatmap for detailed values, or try different parameter settings.",
      },
    ],
  },
  {
    id: "reproduce-paper",
    title: "Reproduce a Published Result",
    description:
      "Download a paper recipe and reproduce a DDA analysis from published research.",
    icon: "FileSearch",
    estimatedMinutes: 15,
    steps: [
      {
        id: "intro",
        type: "narrative",
        title: "Reproducing Published Results",
        content:
          "One of DDALAB's key features is the ability to reproduce DDA results from published papers. Each paper recipe includes the exact dataset, channels, parameters, and expected outcomes.\n\nLet's walk through the process.",
      },
      {
        id: "nav-to-papers",
        type: "auto",
        title: "Navigate to Papers",
        autoAction: {
          type: "navigate",
          payload: { primary: "learn", secondary: "papers" },
        },
      },
      {
        id: "browse-recipes",
        type: "narrative",
        title: "Browse Available Recipes",
        content:
          "The Papers view lists available reproduction recipes. Each card shows:\n\n- **Citation**: Authors, journal, year\n- **Description**: What figure or result to reproduce\n- **Dataset**: Which data is needed\n\nSelect a recipe to see its full details and run it.",
      },
      {
        id: "run-recipe",
        type: "action",
        title: "Run a Recipe",
        actionDescription:
          "Select a recipe card and click 'Run Recipe'. The app will download the required dataset (if needed), pre-fill the DDA parameters, and navigate to the analysis view.",
      },
      {
        id: "compare-results",
        type: "narrative",
        title: "Compare Your Results",
        content:
          "After the analysis completes, compare your results with the reference description in the recipe. The patterns should match the published findings.\n\nNote: Small numerical differences are normal due to floating-point precision and random initialization.",
      },
      {
        id: "complete",
        type: "narrative",
        title: "Reproduction Complete!",
        content:
          "You've successfully reproduced a published DDA result! This workflow validates both the software implementation and your understanding of the analysis.\n\nNew paper recipes are added regularly — check back for more.",
      },
    ],
  },
];
```

**Step 2: Verify TypeScript compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/data/tutorials.ts
git commit -m "feat(learn): define initial tutorial set with getting-started, DDA analysis, and paper reproduction"
```

---

## Task 7: Create Learn frontend components

**Files:**
- Create: `packages/ddalab-tauri/src/components/learn/LearnDashboard.tsx`
- Create: `packages/ddalab-tauri/src/components/learn/TutorialList.tsx`
- Create: `packages/ddalab-tauri/src/components/learn/TutorialRunner.tsx`
- Create: `packages/ddalab-tauri/src/components/learn/SampleDataManager.tsx`
- Create: `packages/ddalab-tauri/src/components/learn/PaperReproductionBrowser.tsx`
- Create: `packages/ddalab-tauri/src/components/learn/index.ts`

This task creates all six component files. Each component follows existing patterns (Radix UI, TailwindCSS, Zustand selectors).

The implementation agent should:
1. Create `index.ts` barrel exporting: `LearnDashboard`, `TutorialList`, `TutorialRunner`, `SampleDataManager`, `PaperReproductionBrowser`
2. Create `LearnDashboard.tsx` — landing page with three cards (Tutorials, Sample Data, Papers) showing counts/status, clicking navigates to secondary tab
3. Create `TutorialList.tsx` — grid of tutorial cards from `tutorials` data, shows progress badges (not started / in progress / completed), click sets `activeTutorialId`
4. Create `TutorialRunner.tsx` — active tutorial overlay: step counter, markdown content, highlight/action handling, prev/next/skip buttons, completes/saves progress
5. Create `SampleDataManager.tsx` — fetches sample data index via `useSampleDataIndex()`, lists datasets with download/delete buttons, shows file size and format, download progress
6. Create `PaperReproductionBrowser.tsx` — fetches recipe index via `usePaperRecipesIndex()`, shows citation cards with search filter, "Run Recipe" button that downloads data + pre-fills DDA params + navigates to analyze/dda

Follow the exact patterns from existing components (Card, CardContent, Badge from Radix UI; `useAppStore` selectors; `memo` wrapping).

**Step 7: Verify TypeScript compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: PASS

**Step 8: Commit**

```bash
git add packages/ddalab-tauri/src/components/learn/
git commit -m "feat(learn): create Learn frontend components (dashboard, tutorials, sample data, papers)"
```

---

## Task 8: Wire Learn views into NavigationContent and Overview

**Files:**
- Modify: `packages/ddalab-tauri/src/components/navigation/NavigationContent.tsx`

**Step 1: Add lazy imports**

After the `GalleryManagementPanel` lazy import (line 194), add:

```typescript
const LearnDashboard = lazy(() =>
  import("@/components/learn").then((mod) => ({
    default: mod.LearnDashboard,
  })),
);
const TutorialList = lazy(() =>
  import("@/components/learn").then((mod) => ({
    default: mod.TutorialList,
  })),
);
const SampleDataManager = lazy(() =>
  import("@/components/learn").then((mod) => ({
    default: mod.SampleDataManager,
  })),
);
const PaperReproductionBrowser = lazy(() =>
  import("@/components/learn").then((mod) => ({
    default: mod.PaperReproductionBrowser,
  })),
);
```

**Step 2: Add MountedView entries**

Before the Settings MountedView (line 477), add:

```tsx
      {/* Learn - Tutorials (default) */}
      <MountedView
        isActive={
          primaryNav === "learn" &&
          (secondaryNav === "tutorials" || !secondaryNav)
        }
      >
        <div className="p-4 h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <TutorialList />
          </Suspense>
        </div>
      </MountedView>

      {/* Learn - Sample Data */}
      <MountedView
        isActive={primaryNav === "learn" && secondaryNav === "sample-data"}
      >
        <div className="p-4 h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <SampleDataManager />
          </Suspense>
        </div>
      </MountedView>

      {/* Learn - Papers */}
      <MountedView
        isActive={primaryNav === "learn" && secondaryNav === "papers"}
      >
        <div className="p-4 h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <PaperReproductionBrowser />
          </Suspense>
        </div>
      </MountedView>
```

**Step 3: Add Learn card to Overview empty state**

In the `OverviewDashboard` function, import `GraduationCap` icon (add to the import on line 22):

```typescript
import { Brain, Activity, FileText, Sparkles, Loader2, GraduationCap } from "lucide-react";
```

In the `{!selectedFile && (...)}` block (line 583-593), replace the simple empty card with cards including a Learn shortcut:

```tsx
      {!selectedFile && (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-12 text-center">
              <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">No File Selected</h3>
              <p className="text-muted-foreground">
                Select a file from the sidebar to get started
              </p>
            </CardContent>
          </Card>

          <div>
            <h3 className="text-lg font-semibold mb-3">Get Started</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleQuickAction("learn", "tutorials")}
              >
                <CardContent className="p-6">
                  <GraduationCap className="h-8 w-8 mb-3 text-primary" />
                  <h3 className="font-semibold mb-1">Start Tutorial</h3>
                  <p className="text-sm text-muted-foreground">
                    Interactive guide to DDALAB
                  </p>
                </CardContent>
              </Card>

              <Card
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleQuickAction("learn", "sample-data")}
              >
                <CardContent className="p-6">
                  <Activity className="h-8 w-8 mb-3 text-primary" />
                  <h3 className="font-semibold mb-1">Sample Data</h3>
                  <p className="text-sm text-muted-foreground">
                    Download example EEG datasets
                  </p>
                </CardContent>
              </Card>

              <Card
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleQuickAction("learn", "papers")}
              >
                <CardContent className="p-6">
                  <Brain className="h-8 w-8 mb-3 text-primary" />
                  <h3 className="font-semibold mb-1">Reproduce a Paper</h3>
                  <p className="text-sm text-muted-foreground">
                    Run analyses from published research
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
```

**Step 4: Add GraduationCap to PrimaryNavigation icon map**

In `packages/ddalab-tauri/src/components/navigation/PrimaryNavigation.tsx`, add `GraduationCap` to the Lucide import and to the icon map so that `"GraduationCap"` resolves to the icon component.

**Step 5: Add icons to SecondaryNavigation icon map**

In `packages/ddalab-tauri/src/components/navigation/SecondaryNavigation.tsx`, add `BookOpen`, `Download`, `FileSearch` to the Lucide import and to the icon map.

**Step 6: Verify TypeScript compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/ddalab-tauri/src/components/navigation/NavigationContent.tsx \
  packages/ddalab-tauri/src/components/navigation/PrimaryNavigation.tsx \
  packages/ddalab-tauri/src/components/navigation/SecondaryNavigation.tsx
git commit -m "feat(learn): wire Learn views into navigation and add Overview quick-start cards"
```

---

## Task 9: Final verification

**Step 1: Run full typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: PASS

**Step 2: Run Rust tests**

Run: `cd packages/ddalab-tauri/src-tauri && cargo test --lib`
Expected: All pass (excluding pre-existing filter test failures)

**Step 3: Run formatter**

Run: `cd packages/ddalab-tauri && bun run fmt`
Expected: Formats and completes

**Step 4: Commit any formatting changes**

```bash
git add -u packages/ddalab-tauri/
git commit -m "chore: format learn feature code"
```
