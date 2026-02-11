# Interactive Guided Tutorials & Paper Reproduction

**Date:** 2026-02-09
**Status:** Approved

## Overview

Add a "Learn" primary navigation tab with interactive tutorials, downloadable sample datasets, and paper reproduction recipes. Also surface quick-access cards on the Overview dashboard for discoverability.

## Architecture

Three layers:

1. **Learn Tab** (primary nav) with three secondary views:
   - **Tutorials** - Step-by-step interactive walkthroughs
   - **Sample Data** - Download manager for example datasets
   - **Paper Reproductions** - Browse and execute DDA recipes from published papers

2. **Overview Dashboard Cards** - Quick-access cards on the Overview screen: "Start Tutorial", "Download Sample Data", "Reproduce a Paper Result"

3. **Recipe Registry** - A GitHub repository hosting JSON recipe files. The app fetches a recipe index on demand and caches locally. Follows the same pattern as the plugin registry.

## Tutorial System

### Step Types

Each tutorial is a sequence of steps. A step has one of four types:

| Type | Description |
|------|-------------|
| `narrative` | Markdown text explaining a concept |
| `action` | Instructs the user to perform an action; app watches for completion |
| `highlight` | Points to a UI element via `data-tour` attributes (reuses onboarding infrastructure) |
| `auto` | App performs an action automatically while the user watches |

### Tutorial Definitions

Tutorials are defined as TypeScript objects (not remote JSON) since they are tightly coupled to UI logic and `data-tour` selectors.

### Initial Tutorial Set

1. **Getting Started** - Open a file, explore channels, understand the time series view
2. **Your First DDA Analysis** - Configure parameters, run analysis, interpret the heatmap
3. **Batch Analysis** - Run DDA across multiple files, compare results
4. **Advanced: Reproduce a Published Result** - Download a recipe's dataset and run it

### Progress Persistence

Tutorial progress is persisted in the Zustand store (backed by localStorage) so users can resume where they left off.

## Sample Data

### Delivery

Sample datasets are downloaded on demand from GitHub Releases, cached to `~/.ddalab/sample-data/`. No data is bundled in the app binary.

### Registry Format

A `sample-data-index.json` hosted on GitHub:

```json
[
  {
    "id": "eeg-motor-imagery",
    "name": "Motor Imagery EEG",
    "format": "edf",
    "size": 12000000,
    "url": "https://github.com/.../releases/download/v1/motor-imagery.edf",
    "channels": 64,
    "duration": "300s",
    "description": "64-channel EEG recording during motor imagery task"
  }
]
```

### Management UI

The SampleDataManager shows: dataset name, format, size, download progress bar, delete button, total disk usage.

## Paper Reproduction Recipes

### Recipe Format

Each paper recipe is a JSON file in a GitHub repository:

```json
{
  "id": "smith-2023-motor-dda",
  "citation": {
    "authors": "Smith et al.",
    "title": "Delay Differential Analysis of Motor Cortex Dynamics",
    "journal": "NeuroImage",
    "year": 2023,
    "doi": "10.1000/example"
  },
  "description": "Reproduces Figure 3: DDA heatmap of motor cortex channels",
  "dataset": {
    "source": "sample-data",
    "id": "eeg-motor-imagery"
  },
  "steps": {
    "channels": ["C3", "C4", "Cz", "FC1", "FC2"],
    "variant": "dda3",
    "parameters": {
      "tau": [1, 2, 3, 5, 8],
      "windowLength": 2.0,
      "overlap": 0.5
    },
    "referenceResults": {
      "description": "Expected: strong DDA3 coefficients over C3/C4 during motor imagery blocks"
    }
  }
}
```

- `dataset.source` can be `"sample-data"` (references a sample dataset by id) or `"openneuro"` (references an OpenNeuro dataset)
- `steps` fields are populated later as papers are evaluated; a recipe can exist with partial parameters as a placeholder
- `referenceResults.description` is intentionally qualitative (not numerical) to provide guidance without requiring exact floating-point matching

### Registry Index

A `recipes-index.json` lists all available recipes with summary metadata. The full recipe JSON is fetched individually when the user selects one.

## Frontend Components

All new components in `components/learn/`:

| Component | Purpose |
|-----------|---------|
| `LearnDashboard.tsx` | Landing page for Learn tab - tutorial cards, sample data status, paper count |
| `TutorialList.tsx` | Grid of tutorials with progress indicators (not started / in progress / completed) |
| `TutorialRunner.tsx` | Active tutorial view - renders steps, tracks progress, prev/next/skip controls |
| `SampleDataManager.tsx` | Download/manage sample datasets - size, format, progress, delete |
| `PaperReproductionBrowser.tsx` | Browse recipes with search/filter by journal, year, technique |
| `PaperReproductionRunner.tsx` | Executes a recipe - downloads data if needed, pre-fills DDA parameters, navigates to analysis |

## State Management

### Store Slice (`store/slices/learnSlice.ts`)

```typescript
interface LearnSlice {
  // Tutorial progress
  tutorialProgress: Record<string, { currentStep: number; completed: boolean }>;

  // Sample datasets
  sampleDatasets: Record<string, {
    downloaded: boolean;
    path: string | null;
    downloading: boolean;
    progress: number;
  }>;

  // Paper recipes
  recipesIndex: PaperRecipe[] | null;
  recipesLastFetched: number | null;

  // Actions
  startTutorial: (tutorialId: string) => void;
  advanceStep: (tutorialId: string) => void;
  completeTutorial: (tutorialId: string) => void;
  setSampleDataStatus: (datasetId: string, status: Partial<SampleDataStatus>) => void;
  setRecipesIndex: (recipes: PaperRecipe[]) => void;
}
```

### Hook (`hooks/useLearn.ts`)

- `useTutorials()` - tutorial list + progress from store
- `useSampleData()` - TanStack Query for index fetch + download mutations
- `usePaperRecipes()` - TanStack Query for recipe index fetch with caching

## Tauri Commands

| Command | Purpose |
|---------|---------|
| `download_sample_data(url, dataset_id)` | Downloads to `~/.ddalab/sample-data/`, returns local path |
| `delete_sample_data(dataset_id)` | Removes cached file |
| `fetch_remote_index(url)` | Fetches and caches a JSON index (reusable for both sample data and recipes) |
| `get_sample_data_dir()` | Returns platform-appropriate cache directory |
| `list_downloaded_samples()` | Lists downloaded dataset IDs and paths |

## Navigation Integration

- Add `learn` to `PrimaryNavTab` in `types/navigation.ts`
- Secondary tabs: `tutorials`, `sample-data`, `papers`
- Add `MountedView` entries in `NavigationContent.tsx` following existing pattern
- Overview dashboard: add quick-action cards linking to Learn sub-views

## Overview Dashboard Cards

Add to the existing Overview empty state (when no file is loaded):

1. **Start Tutorial** - "New to DDALAB? Follow our interactive guide" -> navigates to Learn > Tutorials
2. **Sample Data** - "Download example EEG datasets to get started" -> navigates to Learn > Sample Data
3. **Reproduce a Paper** - "Run DDA analyses from published research" -> navigates to Learn > Papers

## Key Design Decisions

1. **Tutorials as TypeScript, recipes as remote JSON** - Tutorials are coupled to UI selectors and must ship with the app. Paper recipes are data-only and benefit from being updateable without app releases.
2. **Download on demand** - No sample data bundled in binary. Keeps installer small (~50MB instead of ~200MB+).
3. **Qualitative reference results** - Paper recipes describe expected outcomes in words, not exact numbers. Avoids brittle floating-point comparisons.
4. **Reuse existing infrastructure** - Onboarding tour's `data-tour` attributes, plugin registry pattern for remote JSON, MountedView for navigation.
5. **Placeholder recipes** - Recipes can be added with partial parameters and filled in later as papers are evaluated.
