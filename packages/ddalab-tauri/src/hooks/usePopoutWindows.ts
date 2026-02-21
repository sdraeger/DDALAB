import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { windowManager, WindowType } from "@/utils/windowManager";
import { createLogger } from "@/lib/logger";

const logger = createLogger("PopoutWindows");

interface PopoutDataUpdateEventPayload<TData = unknown> {
  windowId: string;
  data: TData;
  timestamp: number;
}

interface PopoutLockStateEventPayload {
  locked: boolean;
}

interface UsePopoutWindowsResult {
  openedWindows: string[];
  createWindow: (
    type: WindowType,
    id: string,
    data: unknown,
  ) => Promise<string>;
  closeWindow: (windowId: string) => Promise<void>;
  updateWindowData: (windowId: string, data: unknown) => Promise<void>;
  toggleWindowLock: (windowId: string) => void;
  isWindowLocked: (windowId: string) => boolean;
  broadcastToType: (type: WindowType, data: unknown) => Promise<void>;
}

export function usePopoutWindows(): UsePopoutWindowsResult {
  const [openedWindows, setOpenedWindows] = useState<string[]>(() =>
    windowManager.getAllWindows(),
  );

  useEffect(() => {
    // Subscribe to window state changes (event-based, no polling)
    const unsubscribe = windowManager.onStateChange((event) => {
      setOpenedWindows(event.allWindows);
    });

    return unsubscribe;
  }, []);

  const createWindow = useCallback(
    async (type: WindowType, id: string, data: unknown): Promise<string> => {
      // State update handled by onStateChange event subscription
      return windowManager.createPopoutWindow(type, id, data);
    },
    [],
  );

  const closeWindow = useCallback(async (windowId: string): Promise<void> => {
    // State update handled by onStateChange event subscription
    await windowManager.closePopoutWindow(windowId);
  }, []);

  const updateWindowData = useCallback(
    async (windowId: string, data: unknown): Promise<void> => {
      await windowManager.sendDataToWindow(windowId, data);
    },
    [],
  );

  const toggleWindowLock = useCallback((windowId: string): void => {
    const state = windowManager.getWindowState(windowId);
    if (state) {
      windowManager.setWindowLock(windowId, !state.isLocked);
    }
  }, []);

  const isWindowLocked = useCallback((windowId: string): boolean => {
    const state = windowManager.getWindowState(windowId);
    return state?.isLocked ?? false;
  }, []);

  const broadcastToType = useCallback(
    async (type: WindowType, data: unknown): Promise<void> => {
      await windowManager.broadcastToType(type, data);
    },
    [],
  );

  // Memoize the return object to prevent creating new references on every render
  return useMemo(
    () => ({
      openedWindows,
      createWindow,
      closeWindow,
      updateWindowData,
      toggleWindowLock,
      isWindowLocked,
      broadcastToType,
    }),
    [
      openedWindows,
      createWindow,
      closeWindow,
      updateWindowData,
      toggleWindowLock,
      isWindowLocked,
      broadcastToType,
    ],
  );
}

interface UsePopoutListenerResult<TData = unknown> {
  data: TData | null;
  isLocked: boolean;
  windowId: string | null;
}

export function usePopoutListener(
  expectedWindowId?: string,
): UsePopoutListenerResult;
export function usePopoutListener<TData>(
  expectedWindowId?: string,
): UsePopoutListenerResult<TData>;
export function usePopoutListener<TData = unknown>(
  expectedWindowId?: string,
): UsePopoutListenerResult<TData> {
  const [data, setData] = useState<TData | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [windowId, setWindowId] = useState<string | null>(null);

  // Use ref to track lock state to avoid stale closures in event listeners
  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;

  useEffect(() => {
    // Get window ID from URL params if not provided
    let currentWindowId = expectedWindowId;
    if (!currentWindowId && typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      currentWindowId = urlParams.get("id") || undefined;
    }

    if (!currentWindowId) return;

    setWindowId(currentWindowId);

    const listeners: UnlistenFn[] = [];
    let cancelled = false;

    const setupDataListener = async () => {
      try {
        const unlisten = await listen<PopoutDataUpdateEventPayload<TData>>(
          `data-update-${currentWindowId}`,
          (event) => {
            // Use ref to get current lock state (avoids stale closure)
            if (!isLockedRef.current) {
              setData(event.payload.data);
            }
          },
        );
        if (!cancelled) {
          listeners.push(unlisten);
        } else {
          // Cleanup immediately if component unmounted during setup
          unlisten();
        }
      } catch (error) {
        logger.error("Failed to setup data listener", {
          windowId: currentWindowId,
          error,
        });
      }
    };

    // Listen for lock state changes
    const setupLockListener = async () => {
      try {
        const unlisten = await listen<PopoutLockStateEventPayload>(
          `lock-state-${currentWindowId}`,
          (event) => {
            setIsLocked(event.payload.locked);
          },
        );
        if (!cancelled) {
          listeners.push(unlisten);
        } else {
          // Cleanup immediately if component unmounted during setup
          unlisten();
        }
      } catch (error) {
        logger.error("Failed to setup lock listener", {
          windowId: currentWindowId,
          error,
        });
      }
    };

    const emitReadyEvent = async () => {
      if (cancelled) return;
      try {
        const { emit } = await import("@tauri-apps/api/event");
        await emit(`popout-ready-${currentWindowId}`, {
          windowId: currentWindowId,
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.warn("Failed to emit popout ready event", {
          windowId: currentWindowId,
          error,
        });
      }
    };

    setupDataListener();
    setupLockListener();
    emitReadyEvent();

    return () => {
      cancelled = true;
      listeners.forEach((unlisten) => unlisten());
    };
  }, [expectedWindowId]);

  return {
    data,
    isLocked,
    windowId,
  };
}
