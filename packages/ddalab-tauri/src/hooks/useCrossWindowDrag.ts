/**
 * Cross-window drag hook for tab docking between windows
 * Enables Chrome/VSCode-like drag-and-drop tab merging
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Tab data transferred during drag */
export interface DraggedTabData {
  filePath: string;
  fileName: string;
}

/** Window bounds from Rust backend */
export interface WindowBounds {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  is_focused: boolean;
}

/** Drag state broadcast to all windows */
export interface CrossWindowDragState {
  isDragging: boolean;
  sourceWindowLabel: string;
  tabData: DraggedTabData | null;
  targetWindowLabel: string | null;
}

/** Event payloads */
export interface TabDragStartedPayload {
  sourceWindowLabel: string;
  tabData: DraggedTabData;
}

export interface TabDragMovedPayload {
  cursorX: number;
  cursorY: number;
  targetWindowLabel: string | null;
}

export interface TabDragEndedPayload {
  targetWindowLabel: string | null;
  cancelled: boolean;
  tabData: DraggedTabData | null;
}

export interface TabTransferPayload {
  targetWindowLabel: string;
  tabData: DraggedTabData;
  sourceWindowLabel: string;
}

// Throttle position updates to ~30fps
const POSITION_UPDATE_THROTTLE_MS = 33;

/**
 * Hook for managing cross-window tab drag operations
 * Used by the source window to track and broadcast drag state
 */
export function useCrossWindowDrag() {
  const [isDragging, setIsDragging] = useState(false);
  const [targetWindowLabel, setTargetWindowLabel] = useState<string | null>(
    null,
  );

  const windowBoundsRef = useRef<WindowBounds[]>([]);
  const sourceWindowLabelRef = useRef<string>("");
  const draggedTabRef = useRef<DraggedTabData | null>(null);
  const lastPositionUpdateRef = useRef<number>(0);
  // Use refs for immediate access (avoids stale closure issues)
  const targetWindowLabelRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);

  /**
   * Start a cross-window drag operation
   * Call this when a tab drag begins
   */
  const startDrag = useCallback(async (tabData: DraggedTabData) => {
    try {
      // Get current window label (synchronous in Tauri v2)
      const currentWindow = getCurrentWindow();
      sourceWindowLabelRef.current = currentWindow.label;
      draggedTabRef.current = tabData;

      // Fetch all window bounds for hit testing
      windowBoundsRef.current = await invoke<WindowBounds[]>(
        "get_all_window_bounds",
      );

      console.log("[CrossWindowDrag] startDrag", {
        sourceWindow: currentWindow.label,
        tabData,
        windowBounds: windowBoundsRef.current,
      });

      isDraggingRef.current = true;
      setIsDragging(true);
      setTargetWindowLabel(null);
      targetWindowLabelRef.current = null;

      // Broadcast drag started to all windows
      await emit("tab-drag-started", {
        sourceWindowLabel: currentWindow.label,
        tabData,
      } satisfies TabDragStartedPayload);
    } catch (error) {
      console.error("[CrossWindowDrag] Failed to start drag:", error);
    }
  }, []);

  /**
   * Update drag position during drag
   * Call this from dnd-kit's onDragMove with screen coordinates
   */
  const updateDragPosition = useCallback(
    (screenX: number, screenY: number) => {
      // Use ref for immediate check (avoids stale state closure)
      if (!isDraggingRef.current) return;

      // Throttle position updates
      const now = Date.now();
      if (now - lastPositionUpdateRef.current < POSITION_UPDATE_THROTTLE_MS) {
        return;
      }
      lastPositionUpdateRef.current = now;

      // Find which window the cursor is over (excluding source window)
      const targetWindow = windowBoundsRef.current.find(
        (w) =>
          w.label !== sourceWindowLabelRef.current &&
          screenX >= w.x &&
          screenX <= w.x + w.width &&
          screenY >= w.y &&
          screenY <= w.y + w.height,
      );

      const newTargetLabel = targetWindow?.label ?? null;

      // Only emit if target changed
      if (newTargetLabel !== targetWindowLabelRef.current) {
        console.log("[CrossWindowDrag] updateDragPosition - target changed", {
          screenX,
          screenY,
          oldTarget: targetWindowLabelRef.current,
          newTarget: newTargetLabel,
          windowBounds: windowBoundsRef.current,
        });
        targetWindowLabelRef.current = newTargetLabel;
        setTargetWindowLabel(newTargetLabel);

        // Broadcast position update
        emit("tab-drag-moved", {
          cursorX: screenX,
          cursorY: screenY,
          targetWindowLabel: newTargetLabel,
        } satisfies TabDragMovedPayload).catch(() => {});
      }
    },
    [], // No dependencies needed since we use refs
  );

  /**
   * End the drag operation
   * Returns the target window label if dropped on another window
   */
  const endDrag = useCallback(
    async (cancelled: boolean = false): Promise<string | null> => {
      // Use ref for immediate access (avoids stale state closure)
      const target = cancelled ? null : targetWindowLabelRef.current;
      const tabData = draggedTabRef.current;

      console.log("[CrossWindowDrag] endDrag", {
        cancelled,
        target,
        tabData,
        sourceWindow: sourceWindowLabelRef.current,
      });

      // Broadcast drag ended
      await emit("tab-drag-ended", {
        targetWindowLabel: target,
        cancelled,
        tabData,
      } satisfies TabDragEndedPayload).catch(() => {});

      // If dropped on another window, emit transfer event
      if (target && tabData) {
        console.log("[CrossWindowDrag] emitting tab-transfer", {
          targetWindowLabel: target,
          tabData,
          sourceWindowLabel: sourceWindowLabelRef.current,
        });
        await emit("tab-transfer", {
          targetWindowLabel: target,
          tabData,
          sourceWindowLabel: sourceWindowLabelRef.current,
        } satisfies TabTransferPayload).catch(() => {});
      }

      // Reset state
      isDraggingRef.current = false;
      setIsDragging(false);
      setTargetWindowLabel(null);
      targetWindowLabelRef.current = null;
      draggedTabRef.current = null;

      return target;
    },
    [], // No dependencies needed since we use refs
  );

  return {
    isDragging,
    targetWindowLabel,
    startDrag,
    updateDragPosition,
    endDrag,
  };
}

/**
 * Hook for listening to cross-window drag events
 * Used by target windows to show drop indicators and receive tabs
 */
export function useCrossWindowDragListener(
  onTabReceived?: (tabData: DraggedTabData) => void,
) {
  const [dragState, setDragState] = useState<CrossWindowDragState>({
    isDragging: false,
    sourceWindowLabel: "",
    tabData: null,
    targetWindowLabel: null,
  });

  const [isDropTarget, setIsDropTarget] = useState(false);
  const windowLabelRef = useRef<string>("");

  useEffect(() => {
    // Get this window's label (synchronous in Tauri v2)
    try {
      const currentWindow = getCurrentWindow();
      windowLabelRef.current = currentWindow.label;
      console.log(
        "[CrossWindowDragListener] initialized for window:",
        currentWindow.label,
      );
    } catch {
      // Not in Tauri environment
      console.log("[CrossWindowDragListener] not in Tauri environment");
    }

    const listeners: UnlistenFn[] = [];

    const setup = async () => {
      // Listen for drag start from other windows
      listeners.push(
        await listen<TabDragStartedPayload>("tab-drag-started", (event) => {
          console.log("[CrossWindowDragListener] tab-drag-started received", {
            myWindow: windowLabelRef.current,
            sourceWindow: event.payload.sourceWindowLabel,
          });
          // Only respond if drag is from a different window
          if (event.payload.sourceWindowLabel !== windowLabelRef.current) {
            setDragState({
              isDragging: true,
              sourceWindowLabel: event.payload.sourceWindowLabel,
              tabData: event.payload.tabData,
              targetWindowLabel: null,
            });
          }
        }),
      );

      // Listen for position updates during drag
      listeners.push(
        await listen<TabDragMovedPayload>("tab-drag-moved", (event) => {
          const isTarget =
            event.payload.targetWindowLabel === windowLabelRef.current;
          setIsDropTarget(isTarget);
          setDragState((prev) => ({
            ...prev,
            targetWindowLabel: event.payload.targetWindowLabel,
          }));
        }),
      );

      // Listen for drag end
      listeners.push(
        await listen<TabDragEndedPayload>("tab-drag-ended", () => {
          setDragState({
            isDragging: false,
            sourceWindowLabel: "",
            tabData: null,
            targetWindowLabel: null,
          });
          setIsDropTarget(false);
        }),
      );

      // Listen for tab transfer to this window
      listeners.push(
        await listen<TabTransferPayload>("tab-transfer", (event) => {
          console.log("[CrossWindowDragListener] tab-transfer received", {
            myWindow: windowLabelRef.current,
            targetWindow: event.payload.targetWindowLabel,
            isForMe: event.payload.targetWindowLabel === windowLabelRef.current,
            tabData: event.payload.tabData,
          });
          if (event.payload.targetWindowLabel === windowLabelRef.current) {
            console.log("[CrossWindowDragListener] calling onTabReceived");
            onTabReceived?.(event.payload.tabData);
          }
        }),
      );
    };

    setup();

    return () => {
      listeners.forEach((unlisten) => unlisten());
    };
  }, [onTabReceived]);

  return {
    dragState,
    isDropTarget,
  };
}
