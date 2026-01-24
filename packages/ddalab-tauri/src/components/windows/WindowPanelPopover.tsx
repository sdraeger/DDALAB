"use client";

import { useState, useEffect } from "react";
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
import {
  AppWindow,
  X,
  Lock,
  Unlock,
  Focus,
  Trash2,
} from "lucide-react";
import { usePopoutWindows } from "@/hooks/usePopoutWindows";
import { windowManager, type PopoutWindowState } from "@/utils/windowManager";
import { getPanel } from "@/utils/panelRegistry";
import { cn } from "@/lib/utils";

export function WindowPanelPopover() {
  const { openedWindows, closeWindow, toggleWindowLock, isWindowLocked } =
    usePopoutWindows();
  const [isOpen, setIsOpen] = useState(false);
  const [windowsByPanel, setWindowsByPanel] = useState<
    Map<string, PopoutWindowState[]>
  >(new Map());

  useEffect(() => {
    setWindowsByPanel(windowManager.getWindowsByPanel());
  }, [openedWindows]);

  const totalWindows = openedWindows.length;

  const handleFocusWindow = async (windowId: string) => {
    await windowManager.focusWindow(windowId);
  };

  const handleCloseAll = async () => {
    for (const windowId of openedWindows) {
      await closeWindow(windowId);
    }
    setIsOpen(false);
  };

  const formatWindowId = (id: string): string => {
    const parts = id.split("-");
    if (parts.length >= 3) {
      return `${parts.slice(1, -1).join("-")}`;
    }
    return id.substring(0, 20);
  };

  if (totalWindows === 0) {
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
                  {totalWindows}
                </Badge>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Manage open windows</p>
          </TooltipContent>
        </Tooltip>

        <PopoverContent
          align="end"
          className="w-[320px] p-0"
          sideOffset={8}
        >
          <div className="px-3 py-2 border-b">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Open Windows ({totalWindows})
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
              {Array.from(windowsByPanel.entries()).map(([panelId, windows]) => {
                const panel = getPanel(panelId);
                const Icon = panel?.icon || AppWindow;

                return (
                  <div key={panelId} className="space-y-1">
                    <div className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                      <span>{panel?.title || panelId}</span>
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        {windows.length}
                      </Badge>
                    </div>

                    <div className="space-y-0.5">
                      {windows.map((window) => {
                        const locked = isWindowLocked(window.id);
                        return (
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
                                    onClick={() => toggleWindowLock(window.id)}
                                  >
                                    {locked ? (
                                      <Lock className="h-3 w-3 text-amber-500" />
                                    ) : (
                                      <Unlock className="h-3 w-3" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  {locked ? "Unlock" : "Lock"}
                                </TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 text-destructive hover:text-destructive"
                                    onClick={() => closeWindow(window.id)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">Close</TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
