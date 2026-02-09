/**
 * Store slices barrel export
 */

// Types
export * from "./types";

// Slices
export {
  createFileManagerSlice,
  defaultFileManagerState,
} from "./fileManagerSlice";
export { createPlotSlice, defaultPlotState } from "./plotSlice";
export { createDDASlice, defaultDDAState } from "./ddaSlice";
export { createHealthSlice, defaultHealthState } from "./healthSlice";
export { createSyncSlice, defaultSyncState } from "./syncSlice";
export { createICASlice, defaultICAState } from "./icaSlice";
export { createUISlice, defaultUIState } from "./uiSlice";
export {
  createAnnotationSlice,
  defaultAnnotationState,
} from "./annotationSlice";
export {
  createWorkflowSlice,
  defaultWorkflowRecordingState,
} from "./workflowSlice";
export { createStreamingSlice, defaultStreamingState } from "./streamingSlice";
export { createPersistenceSlice } from "./persistenceSlice";
export { createAnalysisSlice, defaultAnalysisState } from "./analysisSlice";
export type {
  AnalysisJob,
  AnalysisJobStatus,
  AnalysisQueuePreference,
  InterruptedAnalysis,
  AnalysisState,
  AnalysisSlice,
} from "./analysisSlice";
export { createBatchSlice, defaultBatchState } from "./batchSlice";
export type {
  BatchJob,
  BatchJobStatus,
  BatchFileEntry,
  BatchFileStatus,
  BatchSharedParameters,
  BatchState,
  BatchSlice,
} from "./batchSlice";
export {
  createComparisonSlice,
  defaultComparisonState,
} from "./comparisonSlice";
export type {
  ComparisonEntry,
  ComparisonViewMode,
  ComparisonState,
  ComparisonSlice,
} from "./comparisonSlice";
export { createPluginSlice, defaultPluginState } from "./pluginSlice";
export type {
  InstalledPlugin,
  RegistryEntry,
  PluginState,
  PluginSlice,
} from "./pluginSlice";
export { createGallerySlice, defaultGalleryState } from "./gallerySlice";
export type { GalleryState, GallerySlice } from "./gallerySlice";
