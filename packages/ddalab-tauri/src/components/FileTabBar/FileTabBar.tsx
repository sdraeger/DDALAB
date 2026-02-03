"use client";

import React, { useCallback, useRef, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Move,
  GripVertical,
} from "lucide-react";
import { getFileTypeInfo } from "@/utils/fileTypeIcons";
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
} from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import {
  useOpenFilesStore,
  useOpenFiles,
  useActiveFilePath,
  OpenFile,
} from "@/store/openFilesStore";
import { FileTab } from "./FileTab";
import { Button } from "@/components/ui/button";
import { useCrossWindowDrag } from "@/hooks/useCrossWindowDrag";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Threshold in pixels for detecting drag outside window */
const DRAG_OUT_THRESHOLD = 50;

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

interface FileTabBarProps {
  className?: string;
}

/** Drag preview component shown during tab dragging */
function DragPreview({
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
          "transform-gpu", // Enable GPU acceleration
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

interface SortableFileTabProps {
  file: OpenFile;
  isActive: boolean;
  onActivate: (filePath: string) => void;
  onClose: (filePath: string) => void;
  onPin: (filePath: string) => void;
  onUnpin: (filePath: string) => void;
  onCloseOthers: (filePath: string) => void;
  onCloseToRight: (filePath: string) => void;
}

function SortableFileTab({
  file,
  isActive,
  onActivate,
  onClose,
  onPin,
  onUnpin,
  onCloseOthers,
  onCloseToRight,
}: SortableFileTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: file.filePath,
    disabled: file.isPinned,
  });

  const style = {
    transform: DndCSS.Transform.toString(transform),
    transition,
  };

  // Handle native drag start to set OS-level drag image
  const handleNativeDragStart = useCallback(
    (e: React.DragEvent) => {
      if (file.isPinned) {
        e.preventDefault();
        return;
      }

      // Create canvas-based drag image for OS rendering
      const canvas = createDragImage(file.fileName);

      // Position the drag image slightly offset from cursor
      e.dataTransfer.setDragImage(canvas, 20, 16);

      // Set data for potential cross-window transfer
      e.dataTransfer.setData("text/plain", file.filePath);
      e.dataTransfer.effectAllowed = "move";
    },
    [file.fileName, file.filePath, file.isPinned],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-file-path={file.filePath}
      draggable={!file.isPinned}
      onDragStart={handleNativeDragStart}
      {...(file.isPinned ? {} : attributes)}
      {...(file.isPinned ? {} : listeners)}
    >
      <FileTab
        file={file}
        isActive={isActive}
        isDragging={isDragging}
        onActivate={onActivate}
        onClose={onClose}
        onPin={onPin}
        onUnpin={onUnpin}
        onCloseOthers={onCloseOthers}
        onCloseToRight={onCloseToRight}
      />
    </div>
  );
}

/**
 * Container component for file tabs
 * Provides horizontal scrolling and drag-and-drop reordering
 */
export function FileTabBar({ className }: FileTabBarProps) {
  const files = useOpenFiles();
  const activeFilePath = useActiveFilePath();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isDraggingOutside, setIsDraggingOutside] = useState(false);
  const [isDraggingToOtherWindow, setIsDraggingToOtherWindow] = useState(false);
  const dragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const windowPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const {
    setActiveFile,
    closeFile,
    pinFile,
    unpinFile,
    closeOtherFiles,
    closeFilesToRight,
    reorderFiles,
  } = useOpenFilesStore();

  // Cross-window drag hook
  const {
    isDragging: isCrossWindowDragging,
    targetWindowLabel,
    startDrag,
    updateDragPosition,
    endDrag,
  } = useCrossWindowDrag();

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

  const handleDragStart = useCallback(
    async (event: DragStartEvent) => {
      const filePath = event.active.id as string;
      setActiveId(filePath);
      setIsDraggingOutside(false);
      setIsDraggingToOtherWindow(false);
      dragPositionRef.current = null;

      // Get window position for screen coordinate calculation
      try {
        const currentWindow = getCurrentWindow();
        const position = await currentWindow.outerPosition();
        windowPositionRef.current = { x: position.x, y: position.y };

        // Start cross-window drag tracking
        const file = files.find((f) => f.filePath === filePath);
        if (file) {
          await startDrag({
            filePath: file.filePath,
            fileName: file.fileName,
          });
        }
      } catch {
        // Non-Tauri environment, use (0,0)
        windowPositionRef.current = { x: 0, y: 0 };
      }
    },
    [files, startDrag],
  );

  // Track if overlay is currently shown
  const overlayShownRef = useRef(false);

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      // Track the current pointer position
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
        if (isOutside && activeId) {
          const file = files.find((f) => f.filePath === activeId);
          if (file) {
            if (!overlayShownRef.current) {
              // Show the overlay for the first time
              invoke("show_drag_overlay", {
                fileName: file.fileName,
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

        // Update whether we're over another window
        setIsDraggingToOtherWindow(!!targetWindowLabel);
      }
    },
    [updateDragPosition, targetWindowLabel, activeId, files],
  );

  const handleDragEnd = useCallback(
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
        setActiveId(null);
        setIsDraggingOutside(false);
        setIsDraggingToOtherWindow(false);
        dragPositionRef.current = null;

        // Close the tab in this window (it's been transferred)
        // If this was the last tab, the window will remain open but empty
        const isLastTab = files.length === 1;
        await closeFile(filePath);

        // If this was the last tab, close the window (but not the main window)
        if (isLastTab) {
          try {
            const currentWindow = getCurrentWindow();
            if (currentWindow.label !== "main") {
              await currentWindow.close();
            }
          } catch {
            // Ignore errors closing window
          }
        }
        return;
      }

      // Check if dropped outside window bounds - create new window
      if (isDraggingOutside && dragPositionRef.current) {
        setActiveId(null);
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

          // Close the tab in this window (it's been popped out)
          const isLastTab = files.length === 1;
          await closeFile(filePath);

          // If this was the last tab, close the window (but not the main window)
          if (isLastTab) {
            const currentWindow = getCurrentWindow();
            if (currentWindow.label !== "main") {
              await currentWindow.close();
            }
          }
        } catch (error) {
          console.error("Failed to create pop-out window:", error);
        }
        return;
      }

      setActiveId(null);
      setIsDraggingOutside(false);
      setIsDraggingToOtherWindow(false);
      dragPositionRef.current = null;

      if (over && active.id !== over.id) {
        const oldIndex = files.findIndex((f) => f.filePath === active.id);
        const newIndex = files.findIndex((f) => f.filePath === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
          reorderFiles(oldIndex, newIndex);
        }
      }
    },
    [files, reorderFiles, isDraggingOutside, endDrag, closeFile],
  );

  const activeFile = activeId
    ? files.find((f) => f.filePath === activeId)
    : null;

  // Scroll to active tab when it changes
  useEffect(() => {
    if (!activeFilePath || !scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const activeTab = container.querySelector(
      `[data-file-path="${CSS.escape(activeFilePath)}"]`,
    );

    if (activeTab) {
      activeTab.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [activeFilePath]);

  const handleScrollLeft = useCallback(() => {
    if (!scrollContainerRef.current) return;
    scrollContainerRef.current.scrollBy({ left: -200, behavior: "smooth" });
  }, []);

  const handleScrollRight = useCallback(() => {
    if (!scrollContainerRef.current) return;
    scrollContainerRef.current.scrollBy({ left: 200, behavior: "smooth" });
  }, []);

  const handleActivate = useCallback(
    (filePath: string) => {
      setActiveFile(filePath);
    },
    [setActiveFile],
  );

  const handleClose = useCallback(
    async (filePath: string) => {
      await closeFile(filePath);
    },
    [closeFile],
  );

  const handlePin = useCallback(
    (filePath: string) => {
      pinFile(filePath);
    },
    [pinFile],
  );

  const handleUnpin = useCallback(
    (filePath: string) => {
      unpinFile(filePath);
    },
    [unpinFile],
  );

  const handleCloseOthers = useCallback(
    async (filePath: string) => {
      await closeOtherFiles(filePath);
    },
    [closeOtherFiles],
  );

  const handleCloseToRight = useCallback(
    async (filePath: string) => {
      await closeFilesToRight(filePath);
    },
    [closeFilesToRight],
  );

  // Don't render if no files are open
  if (files.length === 0) {
    return null;
  }

  const showScrollButtons = files.length > 5;

  return (
    <div className={cn("flex h-9 items-end bg-muted/30 px-1 pt-1", className)}>
      {/* Left scroll button */}
      {showScrollButtons && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-6 shrink-0 rounded-md mb-0.5"
          onClick={handleScrollLeft}
          aria-label="Scroll tabs left"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      )}

      {/* Scrollable tabs container with drag-and-drop */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={files.map((f) => f.filePath)}
          strategy={horizontalListSortingStrategy}
        >
          <div
            ref={scrollContainerRef}
            className="flex flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden scrollbar-none"
          >
            {files.map((file) => (
              <SortableFileTab
                key={file.filePath}
                file={file}
                isActive={file.filePath === activeFilePath}
                onActivate={handleActivate}
                onClose={handleClose}
                onPin={handlePin}
                onUnpin={handleUnpin}
                onCloseOthers={handleCloseOthers}
                onCloseToRight={handleCloseToRight}
              />
            ))}
          </div>
        </SortableContext>

        {/* Drag overlay for visual feedback - stays visible even outside window */}
        <DragOverlay dropAnimation={dropAnimation} zIndex={9999}>
          {activeFile ? (
            <DragPreview
              fileName={activeFile.fileName}
              isDraggingToOtherWindow={isDraggingToOtherWindow}
              isDraggingOutside={isDraggingOutside}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Right scroll button */}
      {showScrollButtons && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-6 shrink-0 rounded-md mb-0.5"
          onClick={handleScrollRight}
          aria-label="Scroll tabs right"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
