/**
 * UI state slice
 */

import { TauriService } from "@/services/tauriService";
import { debouncedUpdate } from "@/utils/debounce";
import { handleError } from "@/utils/errorHandler";
import type { ImmerStateCreator, UISlice, UIState } from "./types";

export const defaultUIState: UIState = {
  activeTab: "files",
  primaryNav: "explore",
  secondaryNav: "timeseries",
  lastSecondaryNav: {
    overview: null,
    explore: "timeseries",
    analyze: "dda",
    data: "openneuro",
    learn: "tutorials",
    plugins: null,
    collaborate: "gallery",
    settings: null,
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
  collapsedPanels: {},
  ddaActiveTab: "configure",
  encryptionKey: null,
  isEncryptedMode: false,
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

    if (TauriService.isTauri()) {
      debouncedUpdate("ui:sidebarWidth", () => {
        TauriService.updateUIState({ sidebarWidth: clampedWidth }).catch(
          (error) =>
            handleError(error, {
              source: "UI State Persistence",
              severity: "silent",
            }),
        );
      });
    }
  },

  setZoom: (zoom) => {
    const clampedZoom = Math.max(0.75, Math.min(1.5, zoom));
    set((state) => {
      state.ui.zoom = clampedZoom;
    });

    if (TauriService.isTauri()) {
      debouncedUpdate("ui:zoom", () => {
        TauriService.updateUIState({ zoom: clampedZoom }).catch((error) =>
          handleError(error, {
            source: "UI State Persistence",
            severity: "silent",
          }),
        );
      });
    }
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

    if (TauriService.isTauri()) {
      debouncedUpdate("ui:panelSizes", () => {
        TauriService.updateUIState({ panelSizes: sizes }).catch((error) =>
          handleError(error, {
            source: "UI State Persistence",
            severity: "silent",
          }),
        );
      });
    }
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

  setPanelCollapsed: (panelId, collapsed) => {
    set((state) => {
      state.ui.collapsedPanels[panelId] = collapsed;
    });

    if (TauriService.isTauri()) {
      debouncedUpdate(`ui:collapsedPanels:${panelId}`, () => {
        const collapsedPanels = get().ui.collapsedPanels;
        TauriService.updateUIState({ collapsedPanels }).catch((error) =>
          handleError(error, {
            source: "UI State Persistence",
            severity: "silent",
          }),
        );
      });
    }
  },

  togglePanelCollapsed: (panelId) => {
    const current = get().ui.collapsedPanels[panelId] ?? false;
    get().setPanelCollapsed(panelId, !current);
  },

  isPanelCollapsed: (panelId) => {
    return get().ui.collapsedPanels[panelId] ?? false;
  },

  setDDAActiveTab: (tab) => {
    set((state) => {
      state.ui.ddaActiveTab = tab;
    });
  },

  setEncryptionKey: (key) => {
    set((state) => {
      state.ui.encryptionKey = key;
    });
  },

  setEncryptedMode: (enabled) => {
    set((state) => {
      state.ui.isEncryptedMode = enabled;
    });
  },
});
