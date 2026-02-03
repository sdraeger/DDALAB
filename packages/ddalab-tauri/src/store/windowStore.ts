import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";

// Enable Immer's MapSet plugin for Map/Set support in state
enableMapSet();

// ============================================================================
// Types
// ============================================================================

export interface WindowPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowInstance {
  id: string;
  panelId: string;
  tauriLabel: string;
  isLocked: boolean;
  data: unknown;
  position?: WindowPosition;
  createdAt: number;
  lastUpdate: number;
}

export interface WindowGroup {
  panelId: string;
  title: string;
  windows: WindowInstance[];
}

interface WindowStoreState {
  windows: Map<string, WindowInstance>;
  isAppClosing: boolean;
}

interface WindowStoreActions {
  // Window lifecycle
  addWindow: (window: WindowInstance) => void;
  removeWindow: (windowId: string) => void;
  updateWindow: (
    windowId: string,
    updates: Partial<Omit<WindowInstance, "id" | "panelId">>,
  ) => void;

  // Lock management
  setLocked: (windowId: string, locked: boolean) => void;
  toggleLocked: (windowId: string) => void;

  // Position tracking
  updatePosition: (windowId: string, position: WindowPosition) => void;

  // Data updates
  updateData: (windowId: string, data: unknown) => void;

  // App lifecycle
  setAppClosing: (closing: boolean) => void;
  clear: () => void;

  // Selectors
  getWindow: (windowId: string) => WindowInstance | undefined;
  getWindowsByPanel: (panelId: string) => WindowInstance[];
  getGroupedWindows: () => WindowGroup[];
  getAllWindowIds: () => string[];
  getTotalCount: () => number;
}

// ============================================================================
// Store
// ============================================================================

export const useWindowStore = create<WindowStoreState & WindowStoreActions>()(
  subscribeWithSelector(
    immer((set, get) => ({
      // State
      windows: new Map(),
      isAppClosing: false,

      // Actions
      addWindow: (window) =>
        set((state) => {
          state.windows.set(window.id, window);
        }),

      removeWindow: (windowId) =>
        set((state) => {
          state.windows.delete(windowId);
        }),

      updateWindow: (windowId, updates) =>
        set((state) => {
          const window = state.windows.get(windowId);
          if (window) {
            Object.assign(window, updates, { lastUpdate: Date.now() });
          }
        }),

      setLocked: (windowId, locked) =>
        set((state) => {
          const window = state.windows.get(windowId);
          if (window) {
            window.isLocked = locked;
            window.lastUpdate = Date.now();
          }
        }),

      toggleLocked: (windowId) =>
        set((state) => {
          const window = state.windows.get(windowId);
          if (window) {
            window.isLocked = !window.isLocked;
            window.lastUpdate = Date.now();
          }
        }),

      updatePosition: (windowId, position) =>
        set((state) => {
          const window = state.windows.get(windowId);
          if (window) {
            window.position = position;
            window.lastUpdate = Date.now();
          }
        }),

      updateData: (windowId, data) =>
        set((state) => {
          const window = state.windows.get(windowId);
          if (window && !window.isLocked) {
            window.data = data;
            window.lastUpdate = Date.now();
          }
        }),

      setAppClosing: (closing) =>
        set((state) => {
          state.isAppClosing = closing;
        }),

      clear: () =>
        set((state) => {
          state.windows.clear();
        }),

      // Selectors
      getWindow: (windowId) => get().windows.get(windowId),

      getWindowsByPanel: (panelId) =>
        Array.from(get().windows.values()).filter((w) => w.panelId === panelId),

      getGroupedWindows: () => {
        const { windows } = get();
        const groups = new Map<string, WindowInstance[]>();

        for (const window of windows.values()) {
          const existing = groups.get(window.panelId) || [];
          existing.push(window);
          groups.set(window.panelId, existing);
        }

        // Import panel registry dynamically to get titles
        const { getPanel } = require("@/utils/panelRegistry");
        const result: WindowGroup[] = [];

        for (const [panelId, windowList] of groups) {
          const panel = getPanel(panelId);
          result.push({
            panelId,
            title: panel?.title || panelId,
            windows: windowList.sort((a, b) => a.createdAt - b.createdAt),
          });
        }

        return result;
      },

      getAllWindowIds: () => Array.from(get().windows.keys()),

      getTotalCount: () => get().windows.size,
    })),
  ),
);

// ============================================================================
// Convenience Hooks
// ============================================================================

/** Get total window count reactively */
export const useWindowCount = () =>
  useWindowStore((state) => state.windows.size);

/** Get windows grouped by panel reactively */
export const useGroupedWindows = () =>
  useWindowStore((state) => state.getGroupedWindows());

/** Check if any windows are open */
export const useHasWindows = () =>
  useWindowStore((state) => state.windows.size > 0);

/** Get a specific window's state */
export const useWindow = (windowId: string) =>
  useWindowStore((state) => state.windows.get(windowId));

/** Get all windows for a panel type */
export const usePanelWindows = (panelId: string) =>
  useWindowStore((state) =>
    Array.from(state.windows.values()).filter((w) => w.panelId === panelId),
  );
