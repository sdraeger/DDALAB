"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { emit, listen, UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragMoveEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import {
  useCrossWindowDrag,
  useCrossWindowDragListener,
} from "@/hooks/useCrossWindowDrag";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ActiveFileProvider } from "@/contexts/ActiveFileContext";
import { useBackend } from "@/contexts/BackendContext";
import { useAppStore } from "@/store/appStore";
import { useOpenFilesStore } from "@/store/openFilesStore";
import { useUISelectors, useDDASelectors } from "@/hooks/useStoreSelectors";
import { useDDAHistory } from "@/hooks/useDDAAnalysis";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FileNavigationSync } from "@/components/FileNavigationSync";
import { FileTabSync } from "@/components/FileTabSync";
import { MainContentContainer } from "@/components/MainContentContainer";
import { PrimaryNavigation } from "@/components/navigation/PrimaryNavigation";
import { SecondaryNavigation } from "@/components/navigation/SecondaryNavigation";
import { NavigationContent } from "@/components/navigation/NavigationContent";
import { HealthStatusBar } from "@/components/HealthStatusBar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Brain,
  Lock,
  Unlock,
  Maximize2,
  Minimize2,
  X,
  GripVertical,
  Plus,
  ExternalLink,
  Move,
} from "lucide-react";

/** Custom drop animation for smooth transitions */
const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: "0.5",
      },
    },
  }),
  duration: 200,
  easing: "cubic-bezier(0.25, 1, 0.5, 1)",
};
import { cn } from "@/lib/utils";
import { getFileTypeInfo } from "@/utils/fileTypeIcons";
import { TauriService } from "@/services/tauriService";

interface PopoutDashboardProps {
  windowId: string;
  initialFilePath?: string;
}

interface FileTab {
  filePath: string;
  fileName: string;
  isActive: boolean;
}

interface SortableTabProps {
  tab: FileTab;
  onTabClick: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
}

/**
 * Creates an off-screen canvas element to use as a native drag image.
 * This image is rendered by the OS and follows the cursor even outside the window.
 */
function createDragImage(fileName: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Detect dark mode
  const isDarkMode =
    document.documentElement.classList.contains("dark") ||
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  // Color scheme based on mode
  const colors = isDarkMode
    ? {
        background: "#1f2937", // gray-800
        border: "#374151", // gray-700
        text: "#f9fafb", // gray-50
        iconBg: "#3b82f6", // blue-500
        iconFg: "#ffffff",
        shadow: "rgba(0, 0, 0, 0.4)",
      }
    : {
        background: "#ffffff",
        border: "#e5e7eb", // gray-200
        text: "#1f2937", // gray-800
        iconBg: "#3b82f6", // blue-500
        iconFg: "#ffffff",
        shadow: "rgba(0, 0, 0, 0.15)",
      };

  // Set canvas size with extra space for shadow
  const padding = 14;
  const fontSize = 13;
  const iconSize = 18;
  const shadowOffset = 4;
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
  const textWidth = ctx.measureText(fileName).width;
  const width = Math.min(textWidth + iconSize + padding * 3.5 + 8, 280);
  const height = 36;

  // Add shadow space
  canvas.width = (width + shadowOffset * 2) * 2; // 2x for retina
  canvas.height = (height + shadowOffset * 2) * 2;
  canvas.style.width = `${width + shadowOffset * 2}px`;
  canvas.style.height = `${height + shadowOffset * 2}px`;
  ctx.scale(2, 2);

  // Draw shadow
  ctx.shadowColor = colors.shadow;
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 3;

  // Draw rounded rectangle background
  ctx.fillStyle = colors.background;
  ctx.beginPath();
  ctx.roundRect(shadowOffset, shadowOffset, width, height, 8);
  ctx.fill();

  // Reset shadow for border
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Draw file icon (rounded square with document symbol)
  const iconX = shadowOffset + padding;
  const iconY = shadowOffset + (height - iconSize) / 2;
  ctx.fillStyle = colors.iconBg;
  ctx.beginPath();
  ctx.roundRect(iconX, iconY, iconSize, iconSize, 4);
  ctx.fill();

  // Draw document lines on icon
  ctx.strokeStyle = colors.iconFg;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(iconX + 5, iconY + 6);
  ctx.lineTo(iconX + iconSize - 5, iconY + 6);
  ctx.moveTo(iconX + 5, iconY + 9);
  ctx.lineTo(iconX + iconSize - 5, iconY + 9);
  ctx.moveTo(iconX + 5, iconY + 12);
  ctx.lineTo(iconX + iconSize - 7, iconY + 12);
  ctx.stroke();

  // Draw file name
  ctx.fillStyle = colors.text;
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
  const truncatedName =
    fileName.length > 28 ? fileName.slice(0, 25) + "..." : fileName;
  ctx.fillText(
    truncatedName,
    shadowOffset + padding + iconSize + 10,
    shadowOffset + height / 2 + fontSize / 3,
  );

  return canvas;
}

function SortableTab({ tab, onTabClick, onTabClose }: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: tab.filePath,
  });

  const style = {
    transform: DndCSS.Transform.toString(transform),
    transition,
  };

  const fileInfo = getFileTypeInfo(tab.fileName);
  const FileIcon = fileInfo.icon;

  // Handle native drag start to set OS-level drag image
  const handleNativeDragStart = useCallback(
    (e: React.DragEvent) => {
      // Create canvas-based drag image for OS rendering
      const canvas = createDragImage(tab.fileName);

      // Position the drag image slightly offset from cursor
      e.dataTransfer.setDragImage(canvas, 20, 16);

      // Set data for potential cross-window transfer
      e.dataTransfer.setData("text/plain", tab.filePath);
      e.dataTransfer.effectAllowed = "move";
    },
    [tab.fileName, tab.filePath],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      draggable={true}
      onDragStart={handleNativeDragStart}
      className={cn(
        "group flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-t-md cursor-pointer transition-colors",
        tab.isActive
          ? "bg-background border-t border-x text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        isDragging && "opacity-50",
      )}
      onClick={() => onTabClick(tab.filePath)}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-3 w-3 opacity-0 group-hover:opacity-50 cursor-grab" />
      <FileIcon
        className="h-3.5 w-3.5 shrink-0"
        style={{ color: fileInfo.color }}
      />
      <span className="truncate max-w-[150px]">{tab.fileName}</span>
      <button
        className={cn(
          "ml-1 h-4 w-4 rounded-sm flex items-center justify-center",
          "opacity-0 group-hover:opacity-100 hover:bg-muted",
          tab.isActive && "opacity-100",
        )}
        onClick={(e) => {
          e.stopPropagation();
          onTabClose(tab.filePath);
        }}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/** Drag preview component shown during tab dragging in popout windows */
function PopoutDragPreview({
  fileName,
  isDraggingToOtherWindow,
  isDraggingOutside,
}: {
  fileName: string;
  isDraggingToOtherWindow: boolean;
  isDraggingOutside: boolean;
}) {
  const fileInfo = getFileTypeInfo(fileName);
  const FileIcon = fileInfo.icon;

  return (
    <div className="relative cursor-grabbing select-none">
      {/* Main tab preview card */}
      <div
        className={cn(
          "flex items-center gap-2.5 px-4 py-2 rounded-lg",
          "bg-card text-card-foreground",
          "border-2 shadow-2xl",
          "transform-gpu",
          isDraggingToOtherWindow
            ? "scale-105 border-blue-500 bg-blue-50 dark:bg-blue-950/50 shadow-blue-500/50"
            : isDraggingOutside
              ? "scale-105 border-primary bg-primary/5 shadow-primary/50"
              : "border-border",
        )}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground/60" />
        <FileIcon
          className="h-4 w-4 shrink-0"
          style={{ color: fileInfo.color }}
        />
        <span className="text-sm font-medium truncate max-w-[200px]">
          {fileName}
        </span>
      </div>

      {/* Floating action indicator pill */}
      <div
        className={cn(
          "absolute -bottom-9 left-1/2 -translate-x-1/2",
          "flex items-center gap-1.5 px-3 py-1.5 rounded-full",
          "text-xs font-semibold whitespace-nowrap",
          "shadow-xl border",
          "transition-all duration-150 ease-out transform-gpu",
          isDraggingToOtherWindow
            ? "bg-blue-500 text-white border-blue-400 opacity-100 scale-100"
            : isDraggingOutside
              ? "bg-primary text-primary-foreground border-primary opacity-100 scale-100"
              : "opacity-0 scale-95 pointer-events-none",
        )}
      >
        {isDraggingToOtherWindow ? (
          <>
            <Move className="h-3.5 w-3.5" />
            <span>Move to window</span>
          </>
        ) : isDraggingOutside ? (
          <>
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Open in new window</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Full DDALAB Dashboard for popout windows
 *
 * Provides the complete DDALAB experience including:
 * - Navigation (Overview, Explore, Analyze, etc.)
 * - File analysis and visualization
 * - Tab management with drag support
 */
export function PopoutDashboard({
  windowId,
  initialFilePath,
}: PopoutDashboardProps) {
  const { isReady: isBackendReady } = useBackend();

  // Window state
  const [isMaximized, setIsMaximized] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // dnd-kit state for cross-window drag
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [isDraggingOutside, setIsDraggingOutside] = useState(false);
  const [isDraggingToOtherWindow, setIsDraggingToOtherWindow] = useState(false);
  const dragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const windowPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Cross-window drag hook for outgoing drags
  const { targetWindowLabel, startDrag, updateDragPosition, endDrag } =
    useCrossWindowDrag();

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // UI selectors
  const { primaryNav, secondaryNav, setPrimaryNav, setSecondaryNav } =
    useUISelectors();

  const { setCurrentAnalysis, setAnalysisHistory } = useDDASelectors();

  // Global store for setting active file
  const { openFile, setActiveFile } = useOpenFilesStore();
  const isServerReady = useAppStore((state) => state.ui.isServerReady);
  const setServerReady = useAppStore((state) => state.setServerReady);

  // Handle cross-window tab transfers
  const handleCrossWindowTabReceived = useCallback(
    (tabData: { filePath: string; fileName: string }) => {
      const { filePath, fileName } = tabData;
      setTabs((prev) => {
        if (prev.some((t) => t.filePath === filePath)) {
          return prev.map((t) => ({
            ...t,
            isActive: t.filePath === filePath,
          }));
        }
        return [
          ...prev.map((t) => ({ ...t, isActive: false })),
          { filePath, fileName, isActive: true },
        ];
      });
      setActiveTabPath(filePath);
      openFile(filePath);
    },
    [openFile],
  );

  // Listen for cross-window tab transfers (from dnd-kit drag between windows)
  useCrossWindowDragListener(handleCrossWindowTabReceived);

  // Ensure isServerReady is set in popout windows
  // This is normally set by the main window, but popouts need it too
  useEffect(() => {
    if (isBackendReady && !isServerReady) {
      setServerReady(true);
    }
  }, [isBackendReady, isServerReady, setServerReady]);

  // Load DDA history for the current file
  const {
    data: historyData,
    isLoading: isLoadingHistory,
    error: historyError,
  } = useDDAHistory(isServerReady && isBackendReady);

  // Sync history to store
  useEffect(() => {
    if (historyData) {
      setAnalysisHistory(historyData);
    } else if (historyError) {
      setAnalysisHistory([]);
    }
  }, [historyData, historyError, setAnalysisHistory]);

  // Initialize with the file from props
  useEffect(() => {
    if (initialFilePath) {
      const fileName = initialFilePath.split(/[/\\]/).pop() || "Unknown";

      setTabs((prev) => {
        if (prev.some((t) => t.filePath === initialFilePath)) {
          return prev.map((t) => ({
            ...t,
            isActive: t.filePath === initialFilePath,
          }));
        }
        return [
          ...prev.map((t) => ({ ...t, isActive: false })),
          { filePath: initialFilePath, fileName, isActive: true },
        ];
      });
      setActiveTabPath(initialFilePath);

      // Open the file in the global store and make it active
      openFile(initialFilePath);
    }
  }, [initialFilePath, openFile]);

  // Sync active tab to global store when it changes
  useEffect(() => {
    if (activeTabPath) {
      setActiveFile(activeTabPath);
    }
  }, [activeTabPath, setActiveFile]);

  // Listen for lock state changes
  useEffect(() => {
    if (!windowId) return;

    let unlisten: UnlistenFn | undefined;

    const setup = async () => {
      unlisten = await listen<{ locked: boolean }>(
        `lock-state-${windowId}`,
        (event) => {
          setIsLocked(event.payload.locked);
        },
      );
    };

    setup();

    return () => {
      unlisten?.();
    };
  }, [windowId]);

  // NOTE: DDA progress events are handled by useAnalysisEventListener in DashboardLayout
  // The coordinator manages the single event listener and updates Zustand state,
  // which is shared across all windows (main and popouts)

  // Listen for native window close requests (Cmd+W, red circle, Alt+F4)
  // This ensures popout-closing event is emitted even when closed via OS controls
  const isClosingRef = useRef(false);
  useEffect(() => {
    if (!windowId || !TauriService.isTauri()) return;

    let unlisten: (() => void) | undefined;

    const setupCloseListener = async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();

      unlisten = await currentWindow.onCloseRequested(async (event) => {
        // Prevent re-entry (close() would trigger another close request)
        if (isClosingRef.current) return;
        isClosingRef.current = true;

        // Prevent the default close to emit our event first
        event.preventDefault();

        // Emit popout-closing so state persistence can clean up
        await emit("popout-closing", { windowId });

        // Small delay to allow state cleanup
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Use destroy() instead of close() to avoid triggering another close event
        await currentWindow.destroy();
      });
    };

    setupCloseListener();

    return () => {
      unlisten?.();
    };
  }, [windowId]);

  const handleTabClick = useCallback((filePath: string) => {
    setTabs((prev) =>
      prev.map((t) => ({ ...t, isActive: t.filePath === filePath })),
    );
    setActiveTabPath(filePath);
  }, []);

  const handleTabClose = useCallback(
    async (filePath: string) => {
      setTabs((prev) => {
        const newTabs = prev.filter((t) => t.filePath !== filePath);
        if (filePath === activeTabPath && newTabs.length > 0) {
          const closingIndex = prev.findIndex((t) => t.filePath === filePath);
          const newActiveIndex = Math.min(closingIndex, newTabs.length - 1);
          newTabs[newActiveIndex].isActive = true;
          setActiveTabPath(newTabs[newActiveIndex].filePath);
        } else if (newTabs.length === 0) {
          setActiveTabPath(null);
          handleClose();
        }
        return newTabs;
      });
    },
    [activeTabPath],
  );

  const handleLockToggle = async () => {
    const newLocked = !isLocked;
    setIsLocked(newLocked);
    try {
      await emit(`lock-state-${windowId}`, { locked: newLocked });
    } catch {
      // Window may have been closed
    }
  };

  const handleClose = async () => {
    try {
      await emit("popout-closing", { windowId });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {}
  };

  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch {}
  };

  const handleMaximizeToggle = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();
      if (isMaximized) {
        await currentWindow.unmaximize();
      } else {
        await currentWindow.maximize();
      }
      setIsMaximized(!isMaximized);
    } catch {}
  };

  // Threshold for detecting drag outside window
  const DRAG_OUT_THRESHOLD = 50;

  // dnd-kit drag handlers for cross-window support
  const handleDndDragStart = useCallback(
    async (event: DragStartEvent) => {
      const filePath = event.active.id as string;
      setActiveDragId(filePath);
      setIsDraggingOutside(false);
      setIsDraggingToOtherWindow(false);
      dragPositionRef.current = null;

      // Get window position for screen coordinate calculation
      try {
        const currentWindow = getCurrentWindow();
        const position = await currentWindow.outerPosition();
        windowPositionRef.current = { x: position.x, y: position.y };

        // Start cross-window drag tracking
        const tab = tabs.find((t) => t.filePath === filePath);
        if (tab) {
          await startDrag({
            filePath: tab.filePath,
            fileName: tab.fileName,
          });
        }
      } catch {
        windowPositionRef.current = { x: 0, y: 0 };
      }
    },
    [tabs, startDrag],
  );

  // Track if overlay is currently shown
  const overlayShownRef = useRef(false);

  const handleDndDragMove = useCallback(
    (event: DragMoveEvent) => {
      const { activatorEvent } = event;
      if (activatorEvent && "clientX" in activatorEvent) {
        const pointerEvent = activatorEvent as PointerEvent;
        const clientX = pointerEvent.clientX + (event.delta?.x || 0);
        const clientY = pointerEvent.clientY + (event.delta?.y || 0);

        dragPositionRef.current = { x: clientX, y: clientY };

        // Calculate screen coordinates for cross-window detection
        const screenX = windowPositionRef.current.x + clientX;
        const screenY = windowPositionRef.current.y + clientY;

        // Update cross-window drag tracking
        updateDragPosition(screenX, screenY);

        // Check if dragging outside the window bounds
        const isOutside =
          clientY < -DRAG_OUT_THRESHOLD ||
          clientY > window.innerHeight + DRAG_OUT_THRESHOLD ||
          clientX < -DRAG_OUT_THRESHOLD ||
          clientX > window.innerWidth + DRAG_OUT_THRESHOLD;

        setIsDraggingOutside(isOutside);

        // Show/update native overlay window when dragging outside
        if (isOutside && activeDragId) {
          const tab = tabs.find((t) => t.filePath === activeDragId);
          if (tab) {
            if (!overlayShownRef.current) {
              // Show the overlay for the first time
              invoke("show_drag_overlay", {
                fileName: tab.fileName,
                x: screenX,
                y: screenY,
              }).catch(() => {});
              overlayShownRef.current = true;
            } else {
              // Update overlay position
              invoke("update_drag_overlay", {
                x: screenX,
                y: screenY,
              }).catch(() => {});
            }
          }
        } else if (!isOutside && overlayShownRef.current) {
          // Hide overlay when back inside window
          invoke("hide_drag_overlay").catch(() => {});
          overlayShownRef.current = false;
        }

        setIsDraggingToOtherWindow(!!targetWindowLabel);
      }
    },
    [updateDragPosition, targetWindowLabel, activeDragId, tabs],
  );

  const handleDndDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      const filePath = active.id as string;

      // Always hide the overlay when drag ends
      if (overlayShownRef.current) {
        invoke("hide_drag_overlay").catch(() => {});
        overlayShownRef.current = false;
      }

      // End cross-window drag and check if dropped on another window
      const droppedOnWindow = await endDrag(false);

      // Handle cross-window drop
      if (droppedOnWindow) {
        setActiveDragId(null);
        setIsDraggingOutside(false);
        setIsDraggingToOtherWindow(false);
        dragPositionRef.current = null;

        // Remove the tab from this window (it's been transferred)
        setTabs((prev) => {
          const newTabs = prev.filter((t) => t.filePath !== filePath);
          if (filePath === activeTabPath && newTabs.length > 0) {
            const closingIndex = prev.findIndex((t) => t.filePath === filePath);
            const newActiveIndex = Math.min(closingIndex, newTabs.length - 1);
            newTabs[newActiveIndex].isActive = true;
            setActiveTabPath(newTabs[newActiveIndex].filePath);
          } else if (newTabs.length === 0) {
            setActiveTabPath(null);
            // Close this popout window if no tabs left
            handleClose();
          }
          return newTabs;
        });
        return;
      }

      // Check if dropped outside window bounds - create new window
      if (isDraggingOutside && dragPositionRef.current) {
        setActiveDragId(null);
        setIsDraggingOutside(false);
        setIsDraggingToOtherWindow(false);
        dragPositionRef.current = null;

        // Pop out the tab into a new window
        try {
          const { panelService } = await import("@/services/panelService");
          await panelService.createWindow("file-viewer", {
            data: { filePath },
            instanceId: filePath.replace(/[^a-zA-Z0-9]/g, "-"),
          });

          // Remove the tab from this window
          setTabs((prev) => {
            const newTabs = prev.filter((t) => t.filePath !== filePath);
            if (filePath === activeTabPath && newTabs.length > 0) {
              const closingIndex = prev.findIndex(
                (t) => t.filePath === filePath,
              );
              const newActiveIndex = Math.min(closingIndex, newTabs.length - 1);
              newTabs[newActiveIndex].isActive = true;
              setActiveTabPath(newTabs[newActiveIndex].filePath);
            } else if (newTabs.length === 0) {
              setActiveTabPath(null);
              handleClose();
            }
            return newTabs;
          });
        } catch (error) {
          console.error("Failed to create pop-out window:", error);
        }
        return;
      }

      setActiveDragId(null);
      setIsDraggingOutside(false);
      setIsDraggingToOtherWindow(false);
      dragPositionRef.current = null;

      // Handle reordering within the tab bar
      if (over && active.id !== over.id) {
        setTabs((prev) => {
          const oldIndex = prev.findIndex((t) => t.filePath === active.id);
          const newIndex = prev.findIndex((t) => t.filePath === over.id);
          if (oldIndex !== -1 && newIndex !== -1) {
            return arrayMove(prev, oldIndex, newIndex);
          }
          return prev;
        });
      }
    },
    [activeTabPath, isDraggingOutside, endDrag, handleClose],
  );

  const activeDragTab = activeDragId
    ? tabs.find((t) => t.filePath === activeDragId)
    : null;

  // Legacy drag handlers for receiving tabs (backwards compat with native drag)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const filePath = e.dataTransfer.getData("text/plain");
      if (filePath && filePath.startsWith("/")) {
        const fileName = filePath.split(/[/\\]/).pop() || "Unknown";
        setTabs((prev) => {
          if (prev.some((t) => t.filePath === filePath)) {
            return prev.map((t) => ({
              ...t,
              isActive: t.filePath === filePath,
            }));
          }
          return [
            ...prev.map((t) => ({ ...t, isActive: false })),
            { filePath, fileName, isActive: true },
          ];
        });
        setActiveTabPath(filePath);
        openFile(filePath);
      }
    },
    [openFile],
  );

  const activeTab = tabs.find((t) => t.isActive);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Sync active file tab to app store - enables file-dependent features */}
      <FileTabSync />

      {/* Title Bar */}
      <div
        className="h-10 bg-muted/30 border-b flex items-center justify-between px-3 select-none"
        data-tauri-drag-region
      >
        <div className="flex items-center space-x-2">
          <Brain className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold">DDALAB</span>
          {activeTab && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                {activeTab.fileName}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center space-x-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLockToggle}
            className="h-7 w-7 p-0"
            title={isLocked ? "Unlock window" : "Lock window"}
          >
            {isLocked ? (
              <Lock className="h-3.5 w-3.5 text-yellow-600" />
            ) : (
              <Unlock className="h-3.5 w-3.5" />
            )}
          </Button>

          <Separator orientation="vertical" className="h-4" />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleMinimize}
            className="h-7 w-7 p-0"
            title="Minimize"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleMaximizeToggle}
            className="h-7 w-7 p-0"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="h-7 w-7 p-0 hover:bg-red-500 hover:text-white"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Tab Bar with dnd-kit for cross-window drag support */}
      <div
        ref={dropZoneRef}
        className={cn(
          "h-9 bg-muted/20 border-b flex items-end px-1 transition-colors",
          isDragOver && "bg-primary/10 border-primary",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDndDragStart}
          onDragMove={handleDndDragMove}
          onDragEnd={handleDndDragEnd}
        >
          <SortableContext
            items={tabs.map((t) => t.filePath)}
            strategy={horizontalListSortingStrategy}
          >
            <ScrollArea className="flex-1">
              <div className="flex items-end gap-0.5 h-full">
                {tabs.map((tab) => (
                  <SortableTab
                    key={tab.filePath}
                    tab={tab}
                    onTabClick={handleTabClick}
                    onTabClose={handleTabClose}
                  />
                ))}

                {isDragOver && (
                  <div className="flex items-center gap-1 px-3 py-1.5 text-sm text-primary border border-dashed border-primary rounded-t-md bg-primary/5">
                    <Plus className="h-3.5 w-3.5" />
                    <span>Drop here</span>
                  </div>
                )}
              </div>
            </ScrollArea>
          </SortableContext>

          {/* Drag overlay for visual feedback - stays visible even outside window */}
          <DragOverlay dropAnimation={dropAnimation} zIndex={9999}>
            {activeDragTab ? (
              <PopoutDragPreview
                fileName={activeDragTab.fileName}
                isDraggingToOtherWindow={isDraggingToOtherWindow}
                isDraggingOutside={isDraggingOutside}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Lock indicator */}
      {isLocked && (
        <div className="bg-yellow-50 dark:bg-yellow-950/30 border-b border-yellow-200 dark:border-yellow-800 px-3 py-2">
          <div className="flex items-center space-x-2 text-yellow-800 dark:text-yellow-200">
            <Lock className="h-4 w-4" />
            <span className="text-sm font-medium">
              Window is locked - not receiving updates
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLockToggle}
              className="h-6 text-xs"
            >
              Unlock
            </Button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {activeTabPath ? (
        <ActiveFileProvider>
          <FileNavigationSync />
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Navigation */}
            <PrimaryNavigation />
            <SecondaryNavigation />

            {/* Content */}
            <MainContentContainer>
              <ErrorBoundary>
                <NavigationContent />
              </ErrorBoundary>
            </MainContentContainer>
          </div>
        </ActiveFileProvider>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <Brain className="h-16 w-16 mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No File Open</h3>
            <p className="text-sm">Drag a tab here to open a file</p>
          </div>
        </div>
      )}

      {/* Status Bar */}
      <HealthStatusBar />
    </div>
  );
}
