"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { BarChart3, Table } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type ChartViewMode = "chart" | "table";

export interface ChartViewToggleProps {
  mode: ChartViewMode;
  onModeChange: (mode: ChartViewMode) => void;
  disabled?: boolean;
  className?: string;
}

export const ChartViewToggle: React.FC<ChartViewToggleProps> = ({
  mode,
  onModeChange,
  disabled = false,
  className = "",
}) => {
  return (
    <TooltipProvider>
      <div
        className={`inline-flex rounded-md shadow-sm ${className}`}
        role="group"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={mode === "chart" ? "default" : "outline"}
              size="sm"
              onClick={() => onModeChange("chart")}
              disabled={disabled}
              className="rounded-r-none"
              aria-label="Show chart view"
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Chart View</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={mode === "table" ? "default" : "outline"}
              size="sm"
              onClick={() => onModeChange("table")}
              disabled={disabled}
              className="rounded-l-none border-l-0"
              aria-label="Show table view (accessible)"
            >
              <Table className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Table View (Accessible)</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
};
