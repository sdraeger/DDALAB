/**
 * PipelineStepCard Component
 *
 * Collapsible card for a single preprocessing step with status indicators
 */

import React, { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type { PipelineStepStatus } from "@/types/preprocessing";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Circle,
  SkipForward,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PipelineStepCardProps {
  stepNumber: number;
  title: string;
  description: string;
  enabled: boolean;
  status: PipelineStepStatus;
  error?: string;
  lastRun?: string;
  duration?: number;
  onToggle: (enabled: boolean) => void;
  isRunning: boolean;
  isCurrent: boolean;
  children: React.ReactNode;
}

const STATUS_ICONS: Record<PipelineStepStatus, React.ReactNode> = {
  idle: <Circle className="h-4 w-4 text-muted-foreground" />,
  pending: <Clock className="h-4 w-4 text-yellow-500" />,
  running: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  error: <AlertCircle className="h-4 w-4 text-red-500" />,
  skipped: <SkipForward className="h-4 w-4 text-muted-foreground" />,
};

const STATUS_COLORS: Record<PipelineStepStatus, string> = {
  idle: "bg-muted text-muted-foreground",
  pending:
    "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400",
  running: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
  completed:
    "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  error: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
  skipped: "bg-muted text-muted-foreground",
};

export function PipelineStepCard({
  stepNumber,
  title,
  description,
  enabled,
  status,
  error,
  lastRun,
  duration,
  onToggle,
  isRunning,
  isCurrent,
  children,
}: PipelineStepCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatLastRun = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString();
  };

  return (
    <div
      className={cn(
        "border rounded-lg transition-all",
        isCurrent && "ring-2 ring-primary",
        !enabled && "opacity-60",
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors",
          isExpanded && "border-b",
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Expand/Collapse Icon */}
        <button className="p-0.5 hover:bg-muted rounded">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        {/* Step Number */}
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-sm font-medium">
          {stepNumber}
        </div>

        {/* Status Icon */}
        {STATUS_ICONS[status]}

        {/* Title and Description */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{title}</span>
            <Badge
              variant="outline"
              className={cn("text-xs", STATUS_COLORS[status])}
            >
              {status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {description}
          </p>
        </div>

        {/* Duration and Last Run */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {duration !== undefined && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(duration)}
            </span>
          )}
          {lastRun && (
            <span title={`Last run: ${new Date(lastRun).toLocaleString()}`}>
              {formatLastRun(lastRun)}
            </span>
          )}
        </div>

        {/* Enable/Disable Toggle */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-2"
        >
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={isRunning}
          />
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-red-700 dark:text-red-400">
                  <span className="font-medium">Error: </span>
                  {error}
                </div>
              </div>
            </div>
          )}

          {enabled ? (
            children
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              This step is disabled. Enable it to configure options.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
