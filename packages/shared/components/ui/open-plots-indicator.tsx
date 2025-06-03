"use client";

import { usePersistentPlots } from "../../contexts/PersistentPlotsContext";
import { Button } from "./button";
import { Badge } from "./badge";
import { BarChart3, Eye, EyeOff, Minimize2, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { cn } from "../../lib/utils/misc";

export function OpenPlotsIndicator({ className }: { className?: string }) {
  const {
    openPlots,
    togglePlotVisibility,
    minimizePlot,
    restorePlot,
    removePlot,
    clearAllPlots,
  } = usePersistentPlots();

  if (openPlots.length === 0) return null;

  const visiblePlots = openPlots.filter(
    (plot) => plot.isVisible && !plot.isMinimized
  );
  const hiddenPlots = openPlots.filter(
    (plot) => !plot.isVisible || plot.isMinimized
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("gap-2", className)}>
          <BarChart3 className="h-4 w-4" />
          <span className="hidden sm:inline">Open Plots</span>
          <Badge variant="secondary" className="ml-1">
            {openPlots.length}
          </Badge>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Open Plots ({openPlots.length})</span>
          {openPlots.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllPlots}
              className="h-6 px-2 text-xs text-destructive hover:text-destructive"
            >
              Clear All
            </Button>
          )}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {visiblePlots.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Visible Plots
            </DropdownMenuLabel>
            {visiblePlots.map((plot) => (
              <DropdownMenuItem
                key={plot.id}
                className="flex items-center gap-2 p-2"
              >
                <BarChart3 className="h-4 w-4 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {plot.fileName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {plot.plotType.toUpperCase()} • Last used:{" "}
                    {new Date(plot.lastAccessed).toLocaleTimeString()}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlotVisibility(plot.id);
                    }}
                    className="h-6 w-6 p-0"
                    title="Hide"
                  >
                    <EyeOff className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      minimizePlot(plot.id);
                    }}
                    className="h-6 w-6 p-0"
                    title="Minimize"
                  >
                    <Minimize2 className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePlot(plot.id);
                    }}
                    className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                    title="Close"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </DropdownMenuItem>
            ))}
          </>
        )}

        {hiddenPlots.length > 0 && (
          <>
            {visiblePlots.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Hidden/Minimized Plots
            </DropdownMenuLabel>
            {hiddenPlots.map((plot) => (
              <DropdownMenuItem
                key={plot.id}
                className="flex items-center gap-2 p-2"
              >
                <BarChart3 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate text-muted-foreground">
                    {plot.fileName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {plot.plotType.toUpperCase()} •{" "}
                    {plot.isMinimized ? "Minimized" : "Hidden"}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (plot.isMinimized) {
                        restorePlot(plot.id);
                      } else {
                        togglePlotVisibility(plot.id);
                      }
                    }}
                    className="h-6 w-6 p-0"
                    title={plot.isMinimized ? "Restore" : "Show"}
                  >
                    <Eye className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePlot(plot.id);
                    }}
                    className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                    title="Close"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </DropdownMenuItem>
            ))}
          </>
        )}

        {openPlots.length === 0 && (
          <DropdownMenuItem disabled>
            <span className="text-sm text-muted-foreground">No plots open</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
