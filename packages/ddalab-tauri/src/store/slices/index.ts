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
