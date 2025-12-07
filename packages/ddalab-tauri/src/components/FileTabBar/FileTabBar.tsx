"use client";

import React, { useCallback, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useOpenFilesStore,
  useOpenFiles,
  useActiveFilePath,
} from "@/store/openFilesStore";
import { FileTab } from "./FileTab";
import { Button } from "@/components/ui/button";

interface FileTabBarProps {
  className?: string;
}

/**
 * Container component for file tabs
 * Provides horizontal scrolling when many tabs are open
 */
export function FileTabBar({ className }: FileTabBarProps) {
  const files = useOpenFiles();
  const activeFilePath = useActiveFilePath();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const {
    setActiveFile,
    closeFile,
    pinFile,
    unpinFile,
    closeOtherFiles,
    closeFilesToRight,
  } = useOpenFilesStore();

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
    <div
      className={cn(
        "flex h-8 items-stretch border-b border-border bg-muted/50",
        className,
      )}
    >
      {/* Left scroll button */}
      {showScrollButtons && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-6 shrink-0 rounded-none border-r border-border/50"
          onClick={handleScrollLeft}
          aria-label="Scroll tabs left"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      )}

      {/* Scrollable tabs container */}
      <div
        ref={scrollContainerRef}
        className="flex flex-1 items-stretch overflow-x-auto scrollbar-none"
      >
        {files.map((file) => (
          <div key={file.filePath} data-file-path={file.filePath}>
            <FileTab
              file={file}
              isActive={file.filePath === activeFilePath}
              onActivate={handleActivate}
              onClose={handleClose}
              onPin={handlePin}
              onUnpin={handleUnpin}
              onCloseOthers={handleCloseOthers}
              onCloseToRight={handleCloseToRight}
            />
          </div>
        ))}
      </div>

      {/* Right scroll button */}
      {showScrollButtons && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-6 shrink-0 rounded-none border-l border-border/50"
          onClick={handleScrollRight}
          aria-label="Scroll tabs right"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
