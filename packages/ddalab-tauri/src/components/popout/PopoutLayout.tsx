import React, { useState, useEffect } from "react";
import { emit } from "@tauri-apps/api/event";
import { usePopoutListener } from "@/hooks/usePopoutWindows";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Lock,
  Unlock,
  RefreshCw,
  Maximize2,
  Minimize2,
  X,
  FileX,
} from "lucide-react";

interface PopoutLayoutProps {
  title: string;
  children: React.ReactNode;
  windowId?: string;
  onRefresh?: () => void;
  showRefresh?: boolean;
}

export function PopoutLayout({
  title,
  children,
  windowId,
  onRefresh,
  showRefresh = true,
}: PopoutLayoutProps) {
  const {
    data,
    isLocked,
    windowId: detectedWindowId,
  } = usePopoutListener(windowId);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<string>("");

  const currentWindowId = windowId || detectedWindowId;

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (data && isClient) {
      setLastUpdateTime(new Date().toLocaleTimeString());
    }
  }, [data, isClient]);

  const handleLockToggle = async () => {
    if (currentWindowId) {
      const newLockState = !isLocked;
      // Emit lock-state event that usePopoutListener listens for
      await emit(`lock-state-${currentWindowId}`, { locked: newLockState });
    }
  };

  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
    }
  };

  const handleClose = async () => {
    if (!isClient) return;
    try {
      if (currentWindowId) {
        await emit("popout-closing", { windowId: currentWindowId });
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

  useEffect(() => {
    if (!isClient) return;

    let unlistenResize: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;

    const setupWindowListeners = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();

        unlistenResize = await currentWindow.onResized(() => {});

        unlistenClose = await currentWindow.onCloseRequested(async (event) => {
          event.preventDefault();
          if (currentWindowId) {
            await emit("popout-closing", { windowId: currentWindowId });
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          await currentWindow.close();
        });
      } catch {}
    };

    setupWindowListeners();

    return () => {
      unlistenResize?.();
      unlistenClose?.();
    };
  }, [isClient, currentWindowId]);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Custom title bar */}
      <div
        className="h-10 bg-muted/30 border-b flex items-center justify-between px-3 select-none"
        data-tauri-drag-region
      >
        <div className="flex items-center space-x-2">
          <div className="text-sm font-medium text-foreground/80">{title}</div>
          {currentWindowId && (
            <Badge variant="outline" className="text-xs">
              {currentWindowId.split("-")[0]}
            </Badge>
          )}
        </div>

        <div className="flex items-center space-x-1">
          {/* Lock/Unlock button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLockToggle}
            className="h-7 w-7 p-0"
            title={
              isLocked
                ? "Unlock window (stop ignoring main UI changes)"
                : "Lock window (ignore main UI changes)"
            }
            aria-label={isLocked ? "Unlock window" : "Lock window"}
          >
            {isLocked ? (
              <Lock
                className="h-3.5 w-3.5 text-yellow-600"
                aria-hidden="true"
              />
            ) : (
              <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </Button>

          {/* Refresh button */}
          {showRefresh && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              className="h-7 w-7 p-0"
              title="Refresh data"
              aria-label="Refresh data"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}

          <Separator orientation="vertical" className="h-4" />

          {/* Window controls */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMinimize}
            className="h-7 w-7 p-0"
            title="Minimize"
            aria-label="Minimize window"
          >
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleMaximizeToggle}
            className="h-7 w-7 p-0"
            title={isMaximized ? "Restore" : "Maximize"}
            aria-label={isMaximized ? "Restore window" : "Maximize window"}
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="h-7 w-7 p-0 hover:bg-red-500 hover:text-white"
            title="Close"
            aria-label="Close window"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Lock status indicator */}
      {isLocked && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-3 py-2">
          <div className="flex items-center space-x-2 text-yellow-800">
            <Lock className="h-4 w-4" />
            <span className="text-sm font-medium">
              Window is locked - not receiving updates from main UI
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
        {data?.isEmpty ? (
          <div className="h-full w-full flex flex-col items-center justify-center text-muted-foreground">
            <FileX className="h-16 w-16 mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No File Open</h3>
            <p className="text-sm text-center max-w-md">
              All files have been closed in the main window.
              <br />
              Open a file to see data in this popout window.
            </p>
          </div>
        ) : (
          React.cloneElement(children as React.ReactElement<any>, {
            data,
            isLocked,
            windowId: currentWindowId,
          })
        )}
      </div>

      {/* Status bar */}
      <div className="h-6 bg-muted/20 border-t flex items-center justify-between px-3 text-xs text-muted-foreground">
        <div className="flex items-center space-x-4">
          <span>Window ID: {currentWindowId || "Unknown"}</span>
          <span>
            Status: {data?.isEmpty ? "No file" : isLocked ? "Locked" : "Live"}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          {data && !data.isEmpty && isClient && lastUpdateTime && (
            <span>Last update: {lastUpdateTime}</span>
          )}
        </div>
      </div>
    </div>
  );
}
