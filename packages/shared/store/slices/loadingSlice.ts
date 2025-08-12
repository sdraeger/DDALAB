import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface LoadingOperation {
  id: string;
  type:
    | "file-load"
    | "dda-processing"
    | "auth"
    | "upload"
    | "api-request"
    | "data-fetch";
  message: string;
  progress?: number; // 0-100 for progress operations
  startTime: number;
  metadata?: Record<string, any>;
}

export interface LoadingState {
  // Global loading operations
  operations: Record<string, LoadingOperation>;

  // Quick access flags for common loading states
  isGloballyLoading: boolean;
  isDDAProcessing: boolean;
  isFileLoading: boolean;
  isUploading: boolean;

  // Loading overlay settings
  showGlobalOverlay: boolean;
  overlayMessage?: string;
  overlayProgress?: number;
}

const initialState: LoadingState = {
  operations: {},
  isGloballyLoading: false,
  isDDAProcessing: false,
  isFileLoading: false,
  isUploading: false,
  showGlobalOverlay: false,
};

const loadingSlice = createSlice({
  name: "loading",
  initialState,
  reducers: {
    // Start a loading operation
    startLoading: (
      state,
      action: PayloadAction<{
        id: string;
        type: LoadingOperation["type"];
        message: string;
        showGlobalOverlay?: boolean;
        metadata?: Record<string, any>;
      }>
    ) => {
      const {
        id,
        type,
        message,
        showGlobalOverlay = false,
        metadata,
      } = action.payload;

      state.operations[id] = {
        id,
        type,
        message,
        startTime: Date.now(),
        metadata,
      };

      // Update quick access flags
      state.isGloballyLoading = Object.keys(state.operations).length > 0;
      state.isDDAProcessing = Object.values(state.operations).some(
        (op) => op.type === "dda-processing"
      );
      state.isFileLoading = Object.values(state.operations).some(
        (op) => op.type === "file-load"
      );
      state.isUploading = Object.values(state.operations).some(
        (op) => op.type === "upload"
      );

      // Handle global overlay
      if (showGlobalOverlay) {
        state.showGlobalOverlay = true;
        state.overlayMessage = message;
      }
    },

    // Update loading progress
    updateProgress: (
      state,
      action: PayloadAction<{
        id: string;
        progress: number;
        message?: string;
      }>
    ) => {
      const { id, progress, message } = action.payload;
      const operation = state.operations[id];

      if (operation) {
        operation.progress = progress;
        if (message) {
          operation.message = message;
        }

        // Update global overlay progress
        if (
          state.showGlobalOverlay &&
          state.overlayMessage === operation.message
        ) {
          state.overlayProgress = progress;
          if (message) {
            state.overlayMessage = message;
          }
        }
      }
    },

    // Stop a loading operation
    stopLoading: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      const operation = state.operations[id];

      delete state.operations[id];

      // Update quick access flags
      state.isGloballyLoading = Object.keys(state.operations).length > 0;
      state.isDDAProcessing = Object.values(state.operations).some(
        (op) => op.type === "dda-processing"
      );
      state.isFileLoading = Object.values(state.operations).some(
        (op) => op.type === "file-load"
      );
      state.isUploading = Object.values(state.operations).some(
        (op) => op.type === "upload"
      );

      // Handle global overlay - hide if this was the overlay operation and no other operations
      if (
        state.showGlobalOverlay &&
        Object.keys(state.operations).length === 0
      ) {
        state.showGlobalOverlay = false;
        state.overlayMessage = undefined;
        state.overlayProgress = undefined;
      }
    },

    // Clear all loading operations
    clearAllLoading: (state) => {
      state.operations = {};
      state.isGloballyLoading = false;
      state.isDDAProcessing = false;
      state.isFileLoading = false;
      state.isUploading = false;
      state.showGlobalOverlay = false;
      state.overlayMessage = undefined;
      state.overlayProgress = undefined;
    },

    // Set global overlay manually
    setGlobalOverlay: (
      state,
      action: PayloadAction<{
        show: boolean;
        message?: string;
        progress?: number;
      }>
    ) => {
      const { show, message, progress } = action.payload;
      state.showGlobalOverlay = show;
      state.overlayMessage = message;
      state.overlayProgress = progress;
    },
    // Sync reducer for popout window synchronization
    syncFromRemote: (state, action: PayloadAction<LoadingState>) => {
      const incomingState = action.payload;

      // For loading states, we want to be selective about what we sync
      // Generally, we don't want to sync loading states as they're window-specific
      // But we might want to sync certain global loading indicators

      if (!incomingState || typeof incomingState !== "object") {
        console.warn(
          "[LoadingSync] Invalid loading state received, ignoring sync"
        );
        return;
      }

      // Only sync specific loading states that should be global
      // For now, we'll sync DDA processing state as it's relevant across windows
      state.isDDAProcessing = incomingState.isDDAProcessing;

      // Sync global overlay if it's showing important information
      if (incomingState.showGlobalOverlay && incomingState.overlayMessage) {
        state.showGlobalOverlay = incomingState.showGlobalOverlay;
        state.overlayMessage = incomingState.overlayMessage;
        state.overlayProgress = incomingState.overlayProgress;
      }

      console.debug("[LoadingSync] Loading state sync (selective changes)");
    },
  },
});

export const {
  startLoading,
  updateProgress,
  stopLoading,
  clearAllLoading,
  setGlobalOverlay,
} = loadingSlice.actions;

// Selectors
export const selectLoadingState = (state: { loading: LoadingState }) =>
  state.loading;
export const selectIsLoading = (state: { loading: LoadingState }, id: string) =>
  !!state.loading.operations[id];
export const selectLoadingOperation = (
  state: { loading: LoadingState },
  id: string
) => state.loading.operations[id];
export const selectLoadingsByType = (
  state: { loading: LoadingState },
  type: LoadingOperation["type"]
) => Object.values(state.loading.operations).filter((op) => op.type === type);
export const selectIsGloballyLoading = (state: { loading: LoadingState }) =>
  state.loading.isGloballyLoading;
export const selectIsDDAProcessing = (state: { loading: LoadingState }) =>
  state.loading.isDDAProcessing;
export const selectIsFileLoading = (state: { loading: LoadingState }) =>
  state.loading.isFileLoading;
export const selectIsUploading = (state: { loading: LoadingState }) =>
  state.loading.isUploading;

export default loadingSlice.reducer;
