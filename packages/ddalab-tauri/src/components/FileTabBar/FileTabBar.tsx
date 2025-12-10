"use client";

import React, { useCallback, useRef, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
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

interface FileTabBarProps {
  className?: string;
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-file-path={file.filePath}
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
  const [activeId, setActiveId] = useState<string | null>(null);

  const {
    setActiveFile,
    closeFile,
    pinFile,
    unpinFile,
    closeOtherFiles,
    closeFilesToRight,
    reorderFiles,
  } = useOpenFilesStore();

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

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (over && active.id !== over.id) {
        const oldIndex = files.findIndex((f) => f.filePath === active.id);
        const newIndex = files.findIndex((f) => f.filePath === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
          reorderFiles(oldIndex, newIndex);
        }
      }
    },
    [files, reorderFiles],
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

        {/* Drag overlay for visual feedback */}
        <DragOverlay>
          {activeFile && (
            <div className="opacity-80">
              <FileTab
                file={activeFile}
                isActive={activeFile.filePath === activeFilePath}
                isDragging
                onActivate={() => {}}
                onClose={() => {}}
                onPin={() => {}}
                onUnpin={() => {}}
                onCloseOthers={() => {}}
                onCloseToRight={() => {}}
              />
            </div>
          )}
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
