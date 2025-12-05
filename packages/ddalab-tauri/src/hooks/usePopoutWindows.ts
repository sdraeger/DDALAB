import { useState, useEffect, useCallback, useMemo } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { windowManager, WindowType } from "@/utils/windowManager";

interface UsePopoutWindowsResult {
  openedWindows: string[];
  createWindow: (type: WindowType, id: string, data: any) => Promise<string>;
  closeWindow: (windowId: string) => Promise<void>;
  updateWindowData: (windowId: string, data: any) => Promise<void>;
  toggleWindowLock: (windowId: string) => void;
  isWindowLocked: (windowId: string) => boolean;
  broadcastToType: (
    type: WindowType,
    eventName: string,
    data: any,
  ) => Promise<void>;
}

export function usePopoutWindows(): UsePopoutWindowsResult {
  const [openedWindows, setOpenedWindows] = useState<string[]>([]);

  useEffect(() => {
    // Initial sync with window manager state
    setOpenedWindows(windowManager.getAllWindows());

    // Subscribe to window state changes (event-based, no polling)
    const unsubscribe = windowManager.onStateChange((event) => {
      setOpenedWindows(event.allWindows);
    });

    return unsubscribe;
  }, []);

  const createWindow = useCallback(
    async (type: WindowType, id: string, data: any): Promise<string> => {
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
    async (windowId: string, data: any): Promise<void> => {
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
    async (type: WindowType, eventName: string, data: any): Promise<void> => {
      await windowManager.broadcastToType(type, eventName, data);
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

interface UsePopoutListenerResult {
  data: any;
  isLocked: boolean;
  windowId: string | null;
}

export function usePopoutListener(
  expectedWindowId?: string,
): UsePopoutListenerResult {
  const [data, setData] = useState<any>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [windowId, setWindowId] = useState<string | null>(null);

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

    const setupDataListener = async () => {
      const unlisten = await listen(
        `data-update-${currentWindowId}`,
        (event: any) => {
          if (!isLocked) {
            setData(event.payload.data);
          }
        },
      );
      listeners.push(unlisten);
    };

    // Listen for lock state changes
    const setupLockListener = async () => {
      const unlisten = await listen(
        `lock-state-${currentWindowId}`,
        (event: any) => {
          setIsLocked(event.payload.locked);
        },
      );
      listeners.push(unlisten);
    };

    const emitReadyEvent = async () => {
      const { emit } = await import("@tauri-apps/api/event");
      await emit(`popout-ready-${currentWindowId}`, {
        windowId: currentWindowId,
        timestamp: Date.now(),
      });
    };

    setupDataListener();
    setupLockListener();
    emitReadyEvent();

    return () => {
      listeners.forEach((unlisten) => unlisten());
    };
  }, [expectedWindowId, isLocked]);

  return {
    data,
    isLocked,
    windowId,
  };
}
