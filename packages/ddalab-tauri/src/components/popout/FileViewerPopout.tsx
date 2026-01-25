"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { emit, listen, UnlistenFn } from "@tauri-apps/api/event";
import { usePopoutListener } from "@/hooks/usePopoutWindows";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Lock,
  Unlock,
  RefreshCw,
  Maximize2,
  Minimize2,
  X,
  FileText,
  GripVertical,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getFileTypeInfo } from "@/utils/fileTypeIcons";

interface FileViewerData {
  filePath: string;
  fileName?: string;
}

interface FileTab {
  filePath: string;
  fileName: string;
  isActive: boolean;
}

/**
 * File Viewer Popout Window
 *
 * A standalone window for viewing files. Supports:
 * - Single file viewing (initial state)
 * - Receiving tabs dragged from other windows
 * - Tab bar with drag handle for moving tabs out
 */
export default function FileViewerPopout() {
  const { data, isLocked, windowId } = usePopoutListener();
  const [isMaximized, setIsMaximized] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Initialize with the file from window data
  useEffect(() => {
    if (data && (data as FileViewerData).filePath) {
      const fileData = data as FileViewerData;
      const fileName =
        fileData.fileName ||
        fileData.filePath.split(/[/\\]/).pop() ||
        "Unknown";

      setTabs((prev) => {
        // Don't add if already in tabs
        if (prev.some((t) => t.filePath === fileData.filePath)) {
          return prev.map((t) => ({
            ...t,
            isActive: t.filePath === fileData.filePath,
          }));
        }
        // Add new tab and make it active
        return [
          ...prev.map((t) => ({ ...t, isActive: false })),
          { filePath: fileData.filePath, fileName, isActive: true },
        ];
      });
      setActiveTabPath(fileData.filePath);
    }
  }, [data]);

  // Listen for tab transfer events from other windows
  useEffect(() => {
    if (!isClient || !windowId) return;

    let unlistenTransfer: UnlistenFn | undefined;

    const setup = async () => {
      // Listen for tabs being transferred to this window
      unlistenTransfer = await listen<{ filePath: string; fileName: string }>(
        `tab-transfer-${windowId}`,
        (event) => {
          const { filePath, fileName } = event.payload;
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
        },
      );
    };

    setup();

    return () => {
      unlistenTransfer?.();
    };
  }, [isClient, windowId]);

  const handleTabClick = useCallback((filePath: string) => {
    setTabs((prev) =>
      prev.map((t) => ({ ...t, isActive: t.filePath === filePath })),
    );
    setActiveTabPath(filePath);
  }, []);

  const handleTabClose = useCallback(
    (filePath: string) => {
      setTabs((prev) => {
        const newTabs = prev.filter((t) => t.filePath !== filePath);
        // If closing active tab, activate adjacent
        if (filePath === activeTabPath && newTabs.length > 0) {
          const closingIndex = prev.findIndex((t) => t.filePath === filePath);
          const newActiveIndex = Math.min(closingIndex, newTabs.length - 1);
          newTabs[newActiveIndex].isActive = true;
          setActiveTabPath(newTabs[newActiveIndex].filePath);
        } else if (newTabs.length === 0) {
          setActiveTabPath(null);
          // Close window if no more tabs
          handleClose();
        }
        return newTabs;
      });
    },
    [activeTabPath],
  );

  const handleLockToggle = async () => {
    if (windowId) {
      await emit(`lock-state-${windowId}`, { locked: !isLocked });
    }
  };

  const handleClose = async () => {
    if (!isClient) return;
    try {
      if (windowId) {
        await emit("popout-closing", { windowId });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {}
  };

  const handleMinimize = async () => {
    if (!isClient) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch {}
  };

  const handleMaximizeToggle = async () => {
    if (!isClient) return;
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

  // Handle drag over for receiving tabs
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only set false if leaving the drop zone entirely
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      // Try to get file path from drag data
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
      }
    },
    [windowId],
  );

  const activeTab = tabs.find((t) => t.isActive);
  const activeFileInfo = activeTab
    ? getFileTypeInfo(activeTab.fileName)
    : null;

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Title bar */}
      <div
        className="h-10 bg-muted/30 border-b flex items-center justify-between px-3 select-none"
        data-tauri-drag-region
      >
        <div className="flex items-center space-x-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <div className="text-sm font-medium text-foreground/80">
            {activeTab?.fileName || "File Viewer"}
          </div>
          {windowId && (
            <Badge variant="outline" className="text-xs">
              {windowId.split("-").slice(0, 2).join("-")}
            </Badge>
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

      {/* Tab bar with drop zone */}
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
        <ScrollArea className="flex-1">
          <div className="flex items-end gap-0.5 h-full">
            {tabs.map((tab) => {
              const fileInfo = getFileTypeInfo(tab.fileName);
              const FileIcon = fileInfo.icon;

              return (
                <div
                  key={tab.filePath}
                  className={cn(
                    "group flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-t-md cursor-pointer transition-colors",
                    tab.isActive
                      ? "bg-background border-t border-x text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                  onClick={() => handleTabClick(tab.filePath)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", tab.filePath);
                    e.dataTransfer.effectAllowed = "move";
                  }}
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
                      handleTabClose(tab.filePath);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}

            {/* Drop hint when dragging */}
            {isDragOver && (
              <div className="flex items-center gap-1 px-3 py-1.5 text-sm text-primary border border-dashed border-primary rounded-t-md bg-primary/5">
                <Plus className="h-3.5 w-3.5" />
                <span>Drop here</span>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Lock status indicator */}
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

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {activeTab ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center">
            {activeFileInfo && (
              <activeFileInfo.icon
                className="h-16 w-16 mb-4"
                style={{ color: activeFileInfo.color }}
              />
            )}
            <h2 className="text-xl font-semibold mb-2">{activeTab.fileName}</h2>
            <p className="text-sm text-muted-foreground mb-4 font-mono max-w-lg truncate">
              {activeTab.filePath}
            </p>
            <p className="text-sm text-muted-foreground">
              File viewer window - drag tabs here from other windows
            </p>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <FileText className="h-16 w-16 mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No File Open</h3>
            <p className="text-sm">Drag a tab here to open a file</p>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="h-6 bg-muted/20 border-t flex items-center justify-between px-3 text-xs text-muted-foreground">
        <div className="flex items-center space-x-4">
          <span>
            {tabs.length} {tabs.length === 1 ? "tab" : "tabs"}
          </span>
          <span>Window: {windowId?.split("-").slice(0, 2).join("-")}</span>
        </div>
        <div className="flex items-center space-x-2">
          <span>{isLocked ? "Locked" : "Live"}</span>
        </div>
      </div>
    </div>
  );
}
