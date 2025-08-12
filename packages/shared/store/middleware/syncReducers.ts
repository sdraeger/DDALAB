import { PayloadAction } from "@reduxjs/toolkit";
import { PlotsState } from "../slices/plotSlice";
import { AuthState } from "../slices/authSlice";
import logger from "../../lib/utils/logger";

// Sync reducer for plots slice
export const plotsSyncReducer = (
  state: PlotsState,
  action: PayloadAction<PlotsState>
): PlotsState => {
  const incomingState = action.payload;

  // Validate incoming state structure
  if (!incomingState || typeof incomingState.byFilePath !== "object") {
    logger.warn("[PlotSync] Invalid plots state received, ignoring sync");
    return state;
  }

  // Selective merge strategy - only update specific fields to avoid overwriting local UI state
  const updatedState: PlotsState = {
    ...state,
    currentFilePath: incomingState.currentFilePath,
    byFilePath: { ...state.byFilePath },
  };

  // Merge plot states selectively
  Object.entries(incomingState.byFilePath).forEach(
    ([filePath, incomingPlot]) => {
      const existingPlot = state.byFilePath[filePath];

      if (!existingPlot) {
        // New plot - add it completely
        updatedState.byFilePath[filePath] = incomingPlot;
        logger.debug(`[PlotSync] Added new plot state for: ${filePath}`);
      } else {
        // Existing plot - merge selectively
        updatedState.byFilePath[filePath] = {
          ...existingPlot,
          // Sync data-related fields
          metadata: incomingPlot.metadata,
          edfData: incomingPlot.edfData,
          ddaResults: incomingPlot.ddaResults,
          ddaHeatmapData: incomingPlot.ddaHeatmapData,
          annotations: incomingPlot.annotations,
          preprocessingOptions: incomingPlot.preprocessingOptions,

          // Sync display settings
          selectedChannels: incomingPlot.selectedChannels,
          timeWindow: incomingPlot.timeWindow,
          absoluteTimeWindow: incomingPlot.absoluteTimeWindow,
          zoomLevel: incomingPlot.zoomLevel,
          showHeatmap: incomingPlot.showHeatmap,

          // Sync chunking state
          chunkSizeSeconds: incomingPlot.chunkSizeSeconds,
          currentChunkNumber: incomingPlot.currentChunkNumber,
          totalChunks: incomingPlot.totalChunks,
          chunkStart: incomingPlot.chunkStart,

          // Keep local UI state (don't sync these)
          showSettingsDialog: existingPlot.showSettingsDialog,
          showZoomSettingsDialog: existingPlot.showZoomSettingsDialog,

          // Sync loading states but be careful about race conditions
          isLoading: incomingPlot.isLoading,
          isMetadataLoading: incomingPlot.isMetadataLoading,
          isHeatmapProcessing: incomingPlot.isHeatmapProcessing,
          error: incomingPlot.error,
        };

        logger.debug(`[PlotSync] Updated plot state for: ${filePath}`);
      }
    }
  );

  return updatedState;
};

// Sync reducer for auth slice
export const authSyncReducer = (
  state: AuthState,
  action: PayloadAction<AuthState>
): AuthState => {
  const incomingState = action.payload;

  // Validate incoming auth state
  if (!incomingState || typeof incomingState.isAuthenticated !== "boolean") {
    logger.warn("[AuthSync] Invalid auth state received, ignoring sync");
    return state;
  }

  // For auth, we want to sync everything except loading states
  const updatedState: AuthState = {
    ...state,
    user: incomingState.user,
    isAuthenticated: incomingState.isAuthenticated,
    error: incomingState.error,
    // Keep local loading state
    loading: state.loading,
  };

  logger.debug("[AuthSync] Updated auth state from remote");
  return updatedState;
};

// Sync reducer for loading slice
export const loadingSyncReducer = (
  state: any,
  action: PayloadAction<any>
): any => {
  const incomingState = action.payload;

  // For loading states, we want to be selective about what we sync
  // Generally, we don't want to sync loading states as they're window-specific
  // But we might want to sync certain global loading indicators

  if (!incomingState || typeof incomingState !== "object") {
    logger.warn("[LoadingSync] Invalid loading state received, ignoring sync");
    return state;
  }

  // Only sync specific loading states that should be global
  const updatedState = {
    ...state,
    // Add specific loading states that should be synced across windows
    // For now, keep local loading states
  };

  logger.debug("[LoadingSync] Loading state sync (minimal changes)");
  return updatedState;
};

// Helper function to create sync action types
export const createSyncActionType = (sliceName: string): string => {
  return `${sliceName}/syncFromRemote`;
};

// Helper function to validate sync payload
export const validateSyncPayload = (
  sliceName: string,
  payload: any
): boolean => {
  switch (sliceName) {
    case "plots":
      return (
        payload &&
        typeof payload.byFilePath === "object" &&
        payload.byFilePath !== null &&
        (payload.currentFilePath === null ||
          typeof payload.currentFilePath === "string")
      );

    case "auth":
      return (
        payload &&
        typeof payload.isAuthenticated === "boolean" &&
        (payload.user === null ||
          (payload.user && typeof payload.user.id === "string"))
      );

    case "loading":
      return payload && typeof payload === "object";

    default:
      return true; // Allow unknown slices
  }
};

// Export sync reducers map for easy integration
export const syncReducers = {
  plots: plotsSyncReducer,
  auth: authSyncReducer,
  loading: loadingSyncReducer,
};
