"use client";

import { useState, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AppWindow, X, Lock, Unlock, Focus, Trash2 } from "lucide-react";
import {
  useWindowStore,
  useWindowCount,
  type WindowInstance,
} from "@/store/windowStore";
import { panelService } from "@/services/panelService";
import { getPanel } from "@/utils/panelRegistry";

export function WindowPanelPopover() {
  const [isOpen, setIsOpen] = useState(false);

  // Reactive state from WindowStore
  const windowCount = useWindowCount();
  const windows = useWindowStore(
    useShallow((state) => Array.from(state.windows.values())),
  );

  // Group windows by panel
  const windowsByPanel = useMemo(() => {
    const groups = new Map<
      string,
      { title: string; icon: any; windows: WindowInstance[] }
    >();

    for (const window of windows) {
      if (!groups.has(window.panelId)) {
        const panel = getPanel(window.panelId);
        groups.set(window.panelId, {
          title: panel?.title || window.panelId,
          icon: panel?.icon || AppWindow,
          windows: [],
        });
      }
      groups.get(window.panelId)!.windows.push(window);
    }

    return groups;
  }, [windows]);

  const handleFocusWindow = async (windowId: string) => {
    await panelService.focusWindow(windowId);
  };

  const handleCloseWindow = async (windowId: string) => {
    await panelService.closeWindow(windowId);
  };

  const handleToggleLock = (windowId: string) => {
    panelService.toggleWindowLock(windowId);
  };

  const handleCloseAll = async () => {
    await panelService.closeAllWindows();
    setIsOpen(false);
  };

  const formatWindowId = (id: string): string => {
    const parts = id.split("-");
    if (parts.length >= 3) {
      return parts.slice(1, -1).join("-");
    }
    return id.substring(0, 20);
  };

  if (windowCount === 0) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1.5 text-xs"
              >
                <AppWindow className="h-3.5 w-3.5" />
                <Badge
                  variant="secondary"
                  className="h-4 px-1 text-[10px] font-medium"
                >
                  {windowCount}
                </Badge>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Manage open windows</p>
          </TooltipContent>
        </Tooltip>

        <PopoverContent align="end" className="w-[320px] p-0" sideOffset={8}>
          <div className="px-3 py-2 border-b">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Open Windows ({windowCount})
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                onClick={handleCloseAll}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Close All
              </Button>
            </div>
          </div>

          <ScrollArea className="max-h-[300px]">
            <div className="p-2 space-y-3">
              {Array.from(windowsByPanel.entries()).map(
                ([panelId, { title, icon: Icon, windows: panelWindows }]) => (
                  <div key={panelId} className="space-y-1">
                    <div className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                      <span>{title}</span>
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        {panelWindows.length}
                      </Badge>
                    </div>

                    <div className="space-y-0.5">
                      {panelWindows.map((window) => (
                        <div
                          key={window.id}
                          className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-muted/50 group"
                        >
                          <button
                            onClick={() => handleFocusWindow(window.id)}
                            className="flex-1 text-left text-xs truncate hover:underline"
                          >
                            {formatWindowId(window.id)}
                          </button>

                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5"
                                  onClick={() => handleFocusWindow(window.id)}
                                >
                                  <Focus className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">Focus</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5"
                                  onClick={() => handleToggleLock(window.id)}
                                >
                                  {window.isLocked ? (
                                    <Lock className="h-3 w-3 text-amber-500" />
                                  ) : (
                                    <Unlock className="h-3 w-3" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                {window.isLocked ? "Unlock" : "Lock"}
                              </TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 text-destructive hover:text-destructive"
                                  onClick={() => handleCloseWindow(window.id)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">Close</TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
