import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";

// Panel visibility states
export interface PanelState {
  visible: boolean;
  collapsed?: boolean;
  width?: number;
  height?: number;
}

// Zoom configuration for plots/visualizations
export interface ZoomState {
  level: number; // 0.5 to 2.0 (50% to 200%)
  fitToWidth: boolean;
}

// Split view configuration
export interface SplitViewState {
  enabled: boolean;
  orientation: "horizontal" | "vertical";
  ratio: number; // 0 to 1 (position of divider)
}

// Tab/view state
export interface TabState {
  activeTab: string;
  tabOrder?: string[];
}

interface ViewPersistenceState {
  // Panel states by panel ID
  panels: Record<string, PanelState>;

  // Zoom states by view ID
  zooms: Record<string, ZoomState>;

  // Split view states
  splitViews: Record<string, SplitViewState>;

  // Tab states by container ID
  tabs: Record<string, TabState>;

  // Sidebar state
  sidebar: {
    open: boolean;
    width: number;
    activeSection?: string;
  };

  // Main navigation
  navigation: {
    activeTab: string;
    previousTab?: string;
  };

  // Window state (for Tauri)
  window: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    maximized?: boolean;
    fullscreen?: boolean;
  };

  // Actions
  setPanelState: (panelId: string, state: Partial<PanelState>) => void;
  togglePanel: (panelId: string) => void;
  setZoom: (viewId: string, zoom: Partial<ZoomState>) => void;
  zoomIn: (viewId: string, step?: number) => void;
  zoomOut: (viewId: string, step?: number) => void;
  resetZoom: (viewId: string) => void;
  setSplitView: (viewId: string, state: Partial<SplitViewState>) => void;
  toggleSplitView: (viewId: string) => void;
  setTabState: (containerId: string, state: Partial<TabState>) => void;
  setSidebarState: (state: Partial<ViewPersistenceState["sidebar"]>) => void;
  toggleSidebar: () => void;
  setNavigation: (state: Partial<ViewPersistenceState["navigation"]>) => void;
  setWindowState: (state: Partial<ViewPersistenceState["window"]>) => void;
  resetAllViews: () => void;
}

const DEFAULT_ZOOM: ZoomState = {
  level: 1,
  fitToWidth: false,
};

const DEFAULT_SPLIT: SplitViewState = {
  enabled: false,
  orientation: "horizontal",
  ratio: 0.5,
};

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.1;

export const useViewPersistenceStore = create<ViewPersistenceState>()(
  persist(
    immer((set, get) => ({
      panels: {},
      zooms: {},
      splitViews: {},
      tabs: {},
      sidebar: {
        open: true,
        width: 280,
      },
      navigation: {
        activeTab: "home",
      },
      window: {},

      setPanelState: (panelId, state) => {
        set((draft) => {
          if (!draft.panels[panelId]) {
            draft.panels[panelId] = { visible: true };
          }
          Object.assign(draft.panels[panelId], state);
        });
      },

      togglePanel: (panelId) => {
        set((draft) => {
          if (!draft.panels[panelId]) {
            draft.panels[panelId] = { visible: false };
          } else {
            draft.panels[panelId].visible = !draft.panels[panelId].visible;
          }
        });
      },

      setZoom: (viewId, zoom) => {
        set((draft) => {
          if (!draft.zooms[viewId]) {
            draft.zooms[viewId] = { ...DEFAULT_ZOOM };
          }
          Object.assign(draft.zooms[viewId], zoom);
          // Clamp zoom level
          draft.zooms[viewId].level = Math.min(
            ZOOM_MAX,
            Math.max(ZOOM_MIN, draft.zooms[viewId].level),
          );
        });
      },

      zoomIn: (viewId, step = ZOOM_STEP) => {
        const current = get().zooms[viewId]?.level ?? 1;
        get().setZoom(viewId, { level: current + step, fitToWidth: false });
      },

      zoomOut: (viewId, step = ZOOM_STEP) => {
        const current = get().zooms[viewId]?.level ?? 1;
        get().setZoom(viewId, { level: current - step, fitToWidth: false });
      },

      resetZoom: (viewId) => {
        get().setZoom(viewId, { level: 1, fitToWidth: false });
      },

      setSplitView: (viewId, state) => {
        set((draft) => {
          if (!draft.splitViews[viewId]) {
            draft.splitViews[viewId] = { ...DEFAULT_SPLIT };
          }
          Object.assign(draft.splitViews[viewId], state);
          // Clamp ratio
          draft.splitViews[viewId].ratio = Math.min(
            0.9,
            Math.max(0.1, draft.splitViews[viewId].ratio),
          );
        });
      },

      toggleSplitView: (viewId) => {
        set((draft) => {
          if (!draft.splitViews[viewId]) {
            draft.splitViews[viewId] = { ...DEFAULT_SPLIT, enabled: true };
          } else {
            draft.splitViews[viewId].enabled =
              !draft.splitViews[viewId].enabled;
          }
        });
      },

      setTabState: (containerId, state) => {
        set((draft) => {
          if (!draft.tabs[containerId]) {
            draft.tabs[containerId] = { activeTab: "" };
          }
          Object.assign(draft.tabs[containerId], state);
        });
      },

      setSidebarState: (state) => {
        set((draft) => {
          Object.assign(draft.sidebar, state);
        });
      },

      toggleSidebar: () => {
        set((draft) => {
          draft.sidebar.open = !draft.sidebar.open;
        });
      },

      setNavigation: (state) => {
        set((draft) => {
          // Store previous tab when changing
          if (
            state.activeTab &&
            state.activeTab !== draft.navigation.activeTab
          ) {
            draft.navigation.previousTab = draft.navigation.activeTab;
          }
          Object.assign(draft.navigation, state);
        });
      },

      setWindowState: (state) => {
        set((draft) => {
          Object.assign(draft.window, state);
        });
      },

      resetAllViews: () => {
        set((draft) => {
          draft.panels = {};
          draft.zooms = {};
          draft.splitViews = {};
          draft.tabs = {};
          draft.sidebar = { open: true, width: 280 };
        });
      },
    })),
    {
      name: "ddalab-view-persistence",
      partialize: (state) => ({
        panels: state.panels,
        zooms: state.zooms,
        splitViews: state.splitViews,
        tabs: state.tabs,
        sidebar: state.sidebar,
        navigation: state.navigation,
        window: state.window,
      }),
    },
  ),
);

// Convenience hooks
export function usePanelState(panelId: string) {
  const panel = useViewPersistenceStore((s) => s.panels[panelId]);
  const setPanelState = useViewPersistenceStore((s) => s.setPanelState);
  const togglePanel = useViewPersistenceStore((s) => s.togglePanel);

  return {
    visible: panel?.visible ?? true,
    collapsed: panel?.collapsed ?? false,
    width: panel?.width,
    height: panel?.height,
    setVisible: (visible: boolean) => setPanelState(panelId, { visible }),
    setCollapsed: (collapsed: boolean) => setPanelState(panelId, { collapsed }),
    setWidth: (width: number) => setPanelState(panelId, { width }),
    setHeight: (height: number) => setPanelState(panelId, { height }),
    toggle: () => togglePanel(panelId),
  };
}

export function useZoomState(viewId: string) {
  const zoom = useViewPersistenceStore((s) => s.zooms[viewId]);
  const setZoom = useViewPersistenceStore((s) => s.setZoom);
  const zoomIn = useViewPersistenceStore((s) => s.zoomIn);
  const zoomOut = useViewPersistenceStore((s) => s.zoomOut);
  const resetZoom = useViewPersistenceStore((s) => s.resetZoom);

  return {
    level: zoom?.level ?? 1,
    fitToWidth: zoom?.fitToWidth ?? false,
    setLevel: (level: number) => setZoom(viewId, { level }),
    setFitToWidth: (fit: boolean) => setZoom(viewId, { fitToWidth: fit }),
    zoomIn: (step?: number) => zoomIn(viewId, step),
    zoomOut: (step?: number) => zoomOut(viewId, step),
    reset: () => resetZoom(viewId),
    canZoomIn: (zoom?.level ?? 1) < ZOOM_MAX,
    canZoomOut: (zoom?.level ?? 1) > ZOOM_MIN,
  };
}

export function useSplitViewState(viewId: string) {
  const splitView = useViewPersistenceStore((s) => s.splitViews[viewId]);
  const setSplitView = useViewPersistenceStore((s) => s.setSplitView);
  const toggleSplitView = useViewPersistenceStore((s) => s.toggleSplitView);

  return {
    enabled: splitView?.enabled ?? false,
    orientation: splitView?.orientation ?? "horizontal",
    ratio: splitView?.ratio ?? 0.5,
    setEnabled: (enabled: boolean) => setSplitView(viewId, { enabled }),
    setOrientation: (orientation: "horizontal" | "vertical") =>
      setSplitView(viewId, { orientation }),
    setRatio: (ratio: number) => setSplitView(viewId, { ratio }),
    toggle: () => toggleSplitView(viewId),
  };
}

export function useSidebarState() {
  const sidebar = useViewPersistenceStore((s) => s.sidebar);
  const setSidebarState = useViewPersistenceStore((s) => s.setSidebarState);
  const toggleSidebar = useViewPersistenceStore((s) => s.toggleSidebar);

  return {
    open: sidebar.open,
    width: sidebar.width,
    activeSection: sidebar.activeSection,
    setOpen: (open: boolean) => setSidebarState({ open }),
    setWidth: (width: number) => setSidebarState({ width }),
    setActiveSection: (section: string) =>
      setSidebarState({ activeSection: section }),
    toggle: toggleSidebar,
  };
}
