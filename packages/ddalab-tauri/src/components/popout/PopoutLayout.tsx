import React, { useState, useEffect } from "react";
import { emit } from "@tauri-apps/api/event";
import { usePopoutListener } from "@/hooks/usePopoutWindows";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Lock,
  Unlock,
  RefreshCw,
  Maximize2,
  Minimize2,
  X,
  Info,
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
      const eventName = isLocked
        ? `unlock-window-${currentWindowId}`
        : `lock-window-${currentWindowId}`;
      await emit(eventName);
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
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();
      await currentWindow.close();
    } catch (error) {
      console.error("Failed to close window:", error);
    }
  };

  const handleMinimize = async () => {
    if (!isClient) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();
      await currentWindow.minimize();
    } catch (error) {
      console.error("Failed to minimize window:", error);
    }
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
    } catch (error) {
      console.error("Failed to toggle maximize:", error);
    }
  };

  // Monitor window maximize state
  useEffect(() => {
    if (!isClient) return;

    let unlisten: (() => void) | undefined;

    const setupWindowListeners = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();

        unlisten = await currentWindow.onResized(() => {
          // Could check if window is maximized here, but it's complex
          // For now, we'll rely on the toggle state
        });
      } catch (error) {
        console.error("Failed to setup window listeners:", error);
      }
    };

    setupWindowListeners();

    return () => {
      if (unlisten) unlisten();
    };
  }, [isClient]);

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
          >
            {isLocked ? (
              <Lock className="h-3.5 w-3.5 text-yellow-600" />
            ) : (
              <Unlock className="h-3.5 w-3.5" />
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
            >
              <RefreshCw className="h-3.5 w-3.5" />
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
        {React.cloneElement(children as React.ReactElement<any>, {
          data,
          isLocked,
          windowId: currentWindowId,
        })}
      </div>

      {/* Status bar */}
      <div className="h-6 bg-muted/20 border-t flex items-center justify-between px-3 text-xs text-muted-foreground">
        <div className="flex items-center space-x-4">
          <span>Window ID: {currentWindowId || "Unknown"}</span>
          <span>Status: {isLocked ? "Locked" : "Live"}</span>
        </div>
        <div className="flex items-center space-x-2">
          {data && isClient && lastUpdateTime && (
            <span>Last update: {lastUpdateTime}</span>
          )}
        </div>
      </div>
    </div>
  );
}
