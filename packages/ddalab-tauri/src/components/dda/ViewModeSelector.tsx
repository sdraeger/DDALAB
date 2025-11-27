"use client";

import React from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Grid3x3, TrendingUp, LayoutGrid, Network } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewMode = "heatmap" | "lineplot" | "both" | "network";

interface ViewOption {
  value: ViewMode;
  label: string;
  icon: React.ElementType;
  description: string;
  shortcut?: string;
}

const VIEW_OPTIONS: ViewOption[] = [
  {
    value: "both",
    label: "Both",
    icon: LayoutGrid,
    description: "Show heatmap and line plot together",
    shortcut: "1",
  },
  {
    value: "heatmap",
    label: "Heatmap",
    icon: Grid3x3,
    description: "DDA matrix visualization as colored cells",
    shortcut: "2",
  },
  {
    value: "lineplot",
    label: "Lines",
    icon: TrendingUp,
    description: "Time series line plot per channel",
    shortcut: "3",
  },
  {
    value: "network",
    label: "Network",
    icon: Network,
    description: "Network motif connectivity diagram",
    shortcut: "4",
  },
];

interface ViewModeSelectorProps {
  value: ViewMode;
  onValueChange: (value: ViewMode) => void;
  hasNetworkMotifs?: boolean;
  className?: string;
}

export function ViewModeSelector({
  value,
  onValueChange,
  hasNetworkMotifs = false,
  className,
}: ViewModeSelectorProps) {
  // Filter options based on available data
  const availableOptions = VIEW_OPTIONS.filter(
    (option) => option.value !== "network" || hasNetworkMotifs,
  );

  // Handle keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if not in an input field
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const option = availableOptions.find((opt) => opt.shortcut === e.key);
      if (option) {
        onValueChange(option.value);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [availableOptions, onValueChange]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn("flex items-center gap-2", className)}>
        <span className="text-sm font-medium text-muted-foreground">View</span>
        <ToggleGroup
          value={value}
          onValueChange={(v) => onValueChange(v as ViewMode)}
        >
          {availableOptions.map((option) => {
            const Icon = option.icon;
            const isActive = value === option.value;

            return (
              <Tooltip key={option.value}>
                <TooltipTrigger asChild>
                  <div>
                    <ToggleGroupItem
                      value={option.value}
                      aria-label={option.label}
                      className={cn(
                        "relative",
                        isActive && "ring-1 ring-primary/20",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 transition-colors duration-200",
                          isActive ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span className="hidden sm:inline">{option.label}</span>
                    </ToggleGroupItem>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="flex flex-col gap-1">
                  <div className="font-medium">{option.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {option.description}
                  </div>
                  {option.shortcut && (
                    <div className="text-xs text-muted-foreground">
                      Press{" "}
                      <kbd className="px-1 py-0.5 bg-muted rounded text-xs font-mono">
                        {option.shortcut}
                      </kbd>{" "}
                      to select
                    </div>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </ToggleGroup>
      </div>
    </TooltipProvider>
  );
}
