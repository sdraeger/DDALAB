import { PopoutSyncConfig } from "./popoutSyncMiddleware";
import { RootState } from "../rootReducer";

// Configuration for main window
export const createMainWindowSyncConfig = (): PopoutSyncConfig => ({
  isPopoutWindow: false,
  syncedSlices: ["plots", "auth", "loading"],
  excludedActions: [
    // Redux persist actions
    "persist/PERSIST",
    "persist/REHYDRATE",
    "persist/REGISTER",
    "persist/PURGE",
    "persist/FLUSH",
    "persist/PAUSE",
    "persist/RESUME",
    // Actions that should only happen in main window
    "plots/initialize/pending",
    "plots/loadChunk/pending",
    "auth/loginStart",
    "loading/startLoading",
    // UI-specific actions that shouldn't sync
    "plots/setShowSettingsDialog",
    "plots/setShowZoomSettingsDialog",
  ],
  validationRules: {
    auth: (state) => {
      return (
        state &&
        typeof state.isAuthenticated === "boolean" &&
        (state.user === null ||
          (state.user && typeof state.user.id === "string"))
      );
    },
    plots: (state) => {
      return (
        state &&
        typeof state.byFilePath === "object" &&
        state.byFilePath !== null &&
        (state.currentFilePath === null ||
          typeof state.currentFilePath === "string")
      );
    },
    loading: (state) => {
      return (
        state &&
        typeof state === "object" &&
        typeof state.isGloballyLoading === "boolean"
      );
    },
  },
});

// Configuration for popout window
export const createPopoutWindowSyncConfig = (
  parentOrigin?: string
): PopoutSyncConfig => ({
  isPopoutWindow: true,
  parentWindowOrigin: parentOrigin,
  syncedSlices: ["plots", "auth", "loading"],
  excludedActions: [
    // Redux persist actions
    "persist/PERSIST",
    "persist/REHYDRATE",
    "persist/REGISTER",
    "persist/PURGE",
    "persist/FLUSH",
    "persist/PAUSE",
    "persist/RESUME",
    // Actions that should only happen in main window
    "plots/initialize/pending",
    "plots/loadChunk/pending",
    "auth/loginStart",
    // UI-specific actions that shouldn't sync back to main
    "plots/setShowSettingsDialog",
    "plots/setShowZoomSettingsDialog",
    // Loading actions that are window-specific
    "loading/startLoading",
    "loading/stopLoading",
    "loading/updateProgress",
  ],
  validationRules: {
    auth: (state) => {
      return (
        state &&
        typeof state.isAuthenticated === "boolean" &&
        (state.user === null ||
          (state.user && typeof state.user.id === "string"))
      );
    },
    plots: (state) => {
      return (
        state &&
        typeof state.byFilePath === "object" &&
        state.byFilePath !== null &&
        (state.currentFilePath === null ||
          typeof state.currentFilePath === "string")
      );
    },
    loading: (state) => {
      return (
        state &&
        typeof state === "object" &&
        typeof state.isGloballyLoading === "boolean"
      );
    },
  },
});

// Helper function to determine if we're in a popout window
export const isPopoutWindow = (): boolean => {
  if (typeof window === "undefined") return false;

  // Check if we have an opener (indicating we're a popup)
  if (window.opener && window.opener !== window) {
    return true;
  }

  // Check URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("popout") === "true";
};

// Helper function to get parent window origin
export const getParentWindowOrigin = (): string | undefined => {
  if (typeof window === "undefined" || !window.opener) return undefined;

  try {
    // Try to get the origin from the opener
    return window.opener.location.origin;
  } catch (error) {
    // Cross-origin restriction, use document.referrer as fallback
    if (document.referrer) {
      try {
        return new URL(document.referrer).origin;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
};

// State validation helpers
export const validateStateIntegrity = (state: RootState): boolean => {
  try {
    // Validate auth state
    if (state.auth && typeof state.auth.isAuthenticated !== "boolean") {
      console.warn("[StateValidation] Invalid auth state structure");
      return false;
    }

    // Validate plots state
    if (state.plots) {
      if (
        typeof state.plots.byFilePath !== "object" ||
        state.plots.byFilePath === null
      ) {
        console.warn("[StateValidation] Invalid plots state structure");
        return false;
      }

      // Validate individual plot states
      for (const [filePath, plotState] of Object.entries(
        state.plots.byFilePath
      )) {
        if (!plotState || typeof plotState !== "object") {
          console.warn(`[StateValidation] Invalid plot state for ${filePath}`);
          return false;
        }
      }
    }

    // Validate loading state
    if (state.loading && typeof state.loading.isGloballyLoading !== "boolean") {
      console.warn("[StateValidation] Invalid loading state structure");
      return false;
    }

    return true;
  } catch (error) {
    console.error("[StateValidation] Error validating state:", error);
    return false;
  }
};

// Helper to extract only syncable state
export const extractSyncableState = (state: RootState): Partial<RootState> => {
  const syncableState: Partial<RootState> = {};

  // Extract auth state (excluding loading)
  if (state.auth) {
    syncableState.auth = {
      ...state.auth,
      loading: false, // Don't sync loading state
    };
  }

  // Extract plots state
  if (state.plots) {
    syncableState.plots = {
      ...state.plots,
      byFilePath: { ...state.plots.byFilePath },
    };

    // Clean up UI-specific state from individual plots
    Object.keys(syncableState.plots.byFilePath).forEach((filePath) => {
      const plot = syncableState.plots!.byFilePath[filePath];
      if (plot) {
        // Keep showSettingsDialog and showZoomSettingsDialog as local state
        // They will be preserved in the receiving window
      }
    });
  }

  // Extract loading state (selective)
  if (state.loading) {
    syncableState.loading = {
      ...state.loading,
      // Only sync global indicators, not specific operations
      operations: {}, // Don't sync specific operations
      isGloballyLoading: false, // Recalculate in receiving window
    };
  }

  return syncableState;
};
