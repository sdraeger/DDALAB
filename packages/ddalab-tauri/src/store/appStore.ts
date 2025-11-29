/**
 * Application Store
 *
 * Combines all state slices into a single Zustand store using Immer middleware.
 * Each slice manages a specific domain of application state.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type { AppState } from "./slices/types";
import { createFileManagerSlice } from "./slices/fileManagerSlice";
import { createPlotSlice } from "./slices/plotSlice";
import { createDDASlice } from "./slices/ddaSlice";
import { createHealthSlice } from "./slices/healthSlice";
import { createSyncSlice } from "./slices/syncSlice";
import { createICASlice } from "./slices/icaSlice";
import { createUISlice } from "./slices/uiSlice";
import { createAnnotationSlice } from "./slices/annotationSlice";
import { createWorkflowSlice } from "./slices/workflowSlice";
import { createStreamingSlice } from "./slices/streamingSlice";
import { createPreprocessingSlice } from "./slices/preprocessingSlice";
import { createPersistenceSlice } from "./slices/persistenceSlice";

// Re-export types for backward compatibility
export type {
  FileManagerState,
  PlotState,
  DDAState,
  DelayPreset,
  HealthState,
  SyncState,
  ICAState,
  UIState,
  AnnotationState,
  WorkflowRecordingState,
  StreamingState,
  AppState,
} from "./slices/types";
export type { PreprocessingState } from "./slices/preprocessingSlice";

/**
 * Main application store
 *
 * Uses Zustand with Immer middleware for immutable state updates.
 * State is split into domain-specific slices for better organization.
 */
export const useAppStore = create<AppState>()(
  immer((set, get, store) => ({
    // Combine all slices
    ...createFileManagerSlice(set, get, store),
    ...createPlotSlice(set, get, store),
    ...createDDASlice(set, get, store),
    ...createHealthSlice(set, get, store),
    ...createSyncSlice(set, get, store),
    ...createICASlice(set, get, store),
    ...createUISlice(set, get, store),
    ...createAnnotationSlice(set, get, store),
    ...createWorkflowSlice(set, get, store),
    ...createStreamingSlice(set, get, store),
    ...createPreprocessingSlice(set, get, store),
    ...createPersistenceSlice(set, get, store),
  })),
);
