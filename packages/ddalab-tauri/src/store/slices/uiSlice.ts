/**
 * UI state slice
 */

import { TauriService } from "@/services/tauriService";
import { handleError } from "@/utils/errorHandler";
import type { ImmerStateCreator, UISlice, UIState } from "./types";

// Module-level debounce timers (replaces window object pattern)
let sidebarWidthUpdateTimeout: NodeJS.Timeout | undefined;
let zoomUpdateTimeout: NodeJS.Timeout | undefined;
let panelSizesUpdateTimeout: NodeJS.Timeout | undefined;

export const defaultUIState: UIState = {
  activeTab: "files",
  primaryNav: "explore",
  secondaryNav: "timeseries",
  lastSecondaryNav: {
    overview: null,
    explore: "timeseries",
    analyze: "dda",
    manage: "settings",
    notifications: null,
  },
  sidebarOpen: true,
  sidebarWidth: 320,
  zoom: 1.0,
  panelSizes: [25, 50, 25],
  layout: "default",
  theme: "auto",
  isServerReady: false,
  expertMode: false,
};

export const createUISlice: ImmerStateCreator<UISlice> = (set, get) => ({
  ui: defaultUIState,

  setActiveTab: (tab) => {
    set((state) => {
      state.ui.activeTab = tab;
    });

    if (TauriService.isTauri()) {
      TauriService.updateUIState({ activeTab: tab }).catch((error) =>
        handleError(error, {
          source: "UI State Persistence",
          severity: "silent",
        }),
      );
    }
  },

  setPrimaryNav: (tab) => {
    const { ui } = get();
    const lastSecondary = ui.lastSecondaryNav[tab];

    set((state) => {
      state.ui.primaryNav = tab;
      state.ui.secondaryNav = lastSecondary;
    });

    if (TauriService.isTauri()) {
      TauriService.updateUIState({
        primaryNav: tab,
        secondaryNav: lastSecondary,
      }).catch((error) =>
        handleError(error, {
          source: "UI State Persistence",
          severity: "silent",
        }),
      );
    }
  },

  setSecondaryNav: (tab) => {
    const { ui } = get();

    set((state) => {
      state.ui.secondaryNav = tab;
      state.ui.lastSecondaryNav[ui.primaryNav] = tab;
    });

    if (TauriService.isTauri()) {
      TauriService.updateUIState({ secondaryNav: tab }).catch((error) =>
        handleError(error, {
          source: "UI State Persistence",
          severity: "silent",
        }),
      );
    }
  },

  setSidebarOpen: (open) => {
    set((state) => {
      state.ui.sidebarOpen = open;
    });

    if (TauriService.isTauri()) {
      TauriService.updateUIState({ sidebarOpen: open }).catch((error) =>
        handleError(error, {
          source: "UI State Persistence",
          severity: "silent",
        }),
      );
    }
  },

  setSidebarWidth: (width) => {
    const clampedWidth = Math.max(200, Math.min(600, width));
    set((state) => {
      state.ui.sidebarWidth = clampedWidth;
    });

    // Debounce Tauri state updates
    if (sidebarWidthUpdateTimeout) {
      clearTimeout(sidebarWidthUpdateTimeout);
    }

    sidebarWidthUpdateTimeout = setTimeout(() => {
      if (TauriService.isTauri()) {
        TauriService.updateUIState({ sidebarWidth: clampedWidth }).catch(
          (error) =>
            handleError(error, {
              source: "UI State Persistence",
              severity: "silent",
            }),
        );
      }
    }, 150);
  },

  setZoom: (zoom) => {
    const clampedZoom = Math.max(0.75, Math.min(1.5, zoom));
    set((state) => {
      state.ui.zoom = clampedZoom;
    });

    // Debounce Tauri state updates
    if (zoomUpdateTimeout) {
      clearTimeout(zoomUpdateTimeout);
    }

    zoomUpdateTimeout = setTimeout(() => {
      if (TauriService.isTauri()) {
        TauriService.updateUIState({ zoom: clampedZoom }).catch((error) =>
          handleError(error, {
            source: "UI State Persistence",
            severity: "silent",
          }),
        );
      }
    }, 150);
  },

  increaseZoom: () => {
    const currentZoom = get().ui.zoom;
    const newZoom = Math.min(1.5, currentZoom + 0.1);
    get().setZoom(newZoom);
  },

  decreaseZoom: () => {
    const currentZoom = get().ui.zoom;
    const newZoom = Math.max(0.75, currentZoom - 0.1);
    get().setZoom(newZoom);
  },

  resetZoom: () => {
    get().setZoom(1.0);
  },

  setPanelSizes: (sizes) => {
    set((state) => {
      state.ui.panelSizes = sizes;
    });

    // Debounce Tauri state updates
    if (panelSizesUpdateTimeout) {
      clearTimeout(panelSizesUpdateTimeout);
    }

    panelSizesUpdateTimeout = setTimeout(() => {
      if (TauriService.isTauri()) {
        TauriService.updateUIState({ panelSizes: sizes }).catch((error) =>
          handleError(error, {
            source: "UI State Persistence",
            severity: "silent",
          }),
        );
      }
    }, 150);
  },

  setLayout: (layout) => {
    set((state) => {
      state.ui.layout = layout;
    });

    if (TauriService.isTauri()) {
      TauriService.updateUIState({ layout }).catch((error) =>
        handleError(error, {
          source: "UI State Persistence",
          severity: "silent",
        }),
      );
    }
  },

  setTheme: (theme) => {
    set((state) => {
      state.ui.theme = theme;
    });

    if (TauriService.isTauri()) {
      TauriService.updateUIState({ theme }).catch((error) =>
        handleError(error, {
          source: "UI State Persistence",
          severity: "silent",
        }),
      );
    }
  },

  setServerReady: (ready) => {
    console.log("[SERVER_READY] Setting server ready state:", ready);
    set((state) => {
      state.ui.isServerReady = ready;
    });
  },

  setExpertMode: (enabled) => {
    set((state) => {
      state.ui.expertMode = enabled;
    });

    if (TauriService.isTauri()) {
      TauriService.updateUIState({ expertMode: enabled }).catch((error) =>
        handleError(error, {
          source: "UI State Persistence",
          severity: "silent",
        }),
      );
    }
  },
});
