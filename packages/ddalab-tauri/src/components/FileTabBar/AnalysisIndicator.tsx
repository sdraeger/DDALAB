"use client";

import React, { memo } from "react";
import { Loader2, CheckCircle2, XCircle, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useFileHasRunningAnalysis,
  useFileHasCompletedAnalysis,
  useAnalysisForFile,
} from "@/hooks/useAnalysisCoordinator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface AnalysisIndicatorProps {
  filePath: string;
  onNavigateToAnalysis?: () => void;
}

/**
 * Analysis indicator for file tabs
 *
 * Shows:
 * - Spinning indicator when analysis is running
 * - Green dot when analysis completed successfully
 * - Red dot when analysis failed
 *
 * Clicking opens a popover with details and actions.
 */
export const AnalysisIndicator = memo(function AnalysisIndicator({
  filePath,
  onNavigateToAnalysis,
}: AnalysisIndicatorProps) {
  const isRunning = useFileHasRunningAnalysis(filePath);
  const hasCompleted = useFileHasCompletedAnalysis(filePath);
  const { job, progress, currentStep, cancel, dismiss, hasError } =
    useAnalysisForFile(filePath);

  // Don't show anything if no analysis activity
  if (!isRunning && !hasCompleted && !hasError) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "shrink-0 flex items-center justify-center",
            "rounded-full transition-all duration-200",
            "hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isRunning && "animate-pulse",
          )}
          aria-label={
            isRunning
              ? "Analysis in progress"
              : hasCompleted
                ? "Analysis completed"
                : hasError
                  ? "Analysis failed"
                  : "Analysis status"
          }
        >
          {isRunning ? (
            <Loader2 className="h-3 w-3 text-primary animate-spin" />
          ) : hasCompleted ? (
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
          ) : hasError ? (
            <span className="h-2 w-2 rounded-full bg-red-500 shadow-sm shadow-red-500/50" />
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-72 p-3"
        align="start"
        side="bottom"
        sideOffset={8}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center gap-2">
            {isRunning ? (
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
            ) : hasCompleted ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : hasError ? (
              <XCircle className="h-4 w-4 text-red-500" />
            ) : null}
            <span className="font-medium text-sm">
              {isRunning
                ? "Analysis Running"
                : hasCompleted
                  ? "Analysis Complete"
                  : hasError
                    ? "Analysis Failed"
                    : "Analysis Status"}
            </span>
          </div>

          {/* Progress section for running analysis */}
          {isRunning && (
            <div className="space-y-2">
              <Progress value={progress} className="h-1.5" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate max-w-[180px]">
                  {currentStep || "Processing..."}
                </span>
                <span className="font-medium">{Math.round(progress)}%</span>
              </div>
            </div>
          )}

          {/* Error message */}
          {hasError && job?.error && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {job.error}
            </p>
          )}

          {/* Completion info */}
          {hasCompleted && job?.completedAt && (
            <p className="text-xs text-muted-foreground">
              Completed {formatTimeAgo(job.completedAt)}
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {isRunning && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  cancel();
                }}
              >
                Cancel
              </Button>
            )}

            {(hasCompleted || hasError) && (
              <>
                {onNavigateToAnalysis && (
                  <Button
                    variant="default"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateToAnalysis();
                    }}
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    View
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismiss();
                  }}
                >
                  Dismiss
                </Button>
              </>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});

/**
 * Format timestamp as relative time (e.g., "2 min ago")
 */
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
