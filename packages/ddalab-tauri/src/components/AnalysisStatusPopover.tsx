"use client";

import { memo, useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";
import { tauriBackendService } from "@/services/tauriBackendService";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  X,
  Play,
  ChevronDown,
  FileText,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AnalysisJob,
  InterruptedAnalysis,
} from "@/store/slices/analysisSlice";
import { createLogger } from "@/lib/logger";

const logger = createLogger("AnalysisStatusPopover");

interface AnalysisStatusPopoverProps {
  onNavigateToFile?: (filePath: string) => void;
  onRestartAnalysis?: (analysis: InterruptedAnalysis) => void;
}

/**
 * Status bar popover showing all running and interrupted analyses.
 * Provides cancel functionality and restart options for interrupted analyses.
 */
export const AnalysisStatusPopover = memo(function AnalysisStatusPopover({
  onNavigateToFile,
  onRestartAnalysis,
}: AnalysisStatusPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const {
    jobs,
    interruptedAnalyses,
    removeJob,
    cancelJob,
    removeInterruptedAnalysis,
    setDDARunning,
  } = useAppStore(
    useShallow((state) => ({
      jobs: state.analysis.jobs,
      interruptedAnalyses: state.analysis.interruptedAnalyses,
      removeJob: state.removeJob,
      cancelJob: state.cancelJob,
      removeInterruptedAnalysis: state.removeInterruptedAnalysis,
      setDDARunning: state.setDDARunning,
    })),
  );

  // Get running jobs
  const runningJobs = Object.values(jobs).filter(
    (job) => job.status === "running" || job.status === "pending",
  );

  // Get recently completed/failed jobs (within last 30 seconds)
  const recentJobs = Object.values(jobs).filter(
    (job) =>
      (job.status === "completed" || job.status === "error") &&
      job.completedAt &&
      Date.now() - job.completedAt < 30000,
  );

  const hasRunning = runningJobs.length > 0;
  const hasInterrupted = interruptedAnalyses.length > 0;
  const hasRecent = recentJobs.length > 0;
  const hasContent = hasRunning || hasInterrupted || hasRecent;

  // Handle cancel with backend
  const handleCancel = useCallback(
    async (job: AnalysisJob) => {
      setCancellingId(job.id);
      try {
        const result = await tauriBackendService.cancelDDA();
        if (result.success) {
          logger.info("Analysis cancelled", { id: job.id });
          cancelJob(job.id);
          setDDARunning(false);
        } else {
          logger.warn("Failed to cancel analysis", { message: result.message });
        }
      } catch (error) {
        logger.error("Error cancelling analysis", { error });
      } finally {
        setCancellingId(null);
      }
    },
    [cancelJob, setDDARunning],
  );

  // Dismiss completed/failed job
  const handleDismiss = useCallback(
    (jobId: string) => {
      removeJob(jobId);
    },
    [removeJob],
  );

  // Dismiss interrupted analysis
  const handleDismissInterrupted = useCallback(
    (filePath: string) => {
      removeInterruptedAnalysis(filePath);
    },
    [removeInterruptedAnalysis],
  );

  // Extract filename from path
  const getFileName = (filePath: string) => {
    return filePath.split("/").pop() || filePath;
  };

  // Format elapsed time
  const formatElapsed = (startedAt: number) => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    if (elapsed < 60) return `${elapsed}s`;
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    return `${mins}m ${secs}s`;
  };

  // Don't show anything if no analyses to display
  if (!hasContent) {
    return null;
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center space-x-1 px-1.5 py-0.5 rounded transition-colors",
            hasRunning
              ? "text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
              : hasInterrupted
                ? "text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                : "text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30",
          )}
        >
          {hasRunning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">DDA: {runningJobs.length} running</span>
            </>
          ) : hasInterrupted ? (
            <>
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm">
                {interruptedAnalyses.length} interrupted
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-sm">DDA: done</span>
            </>
          )}
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0" align="start" side="top">
        <div className="p-3 border-b">
          <h4 className="text-sm font-semibold">Analysis Status</h4>
        </div>

        <div className="max-h-72 overflow-y-auto">
          {/* Running Jobs */}
          {runningJobs.length > 0 && (
            <div className="p-2 space-y-2">
              <p className="text-xs font-medium text-muted-foreground px-1">
                Running
              </p>
              {runningJobs.map((job) => (
                <div
                  key={job.id}
                  className="p-2 rounded-md border bg-muted/30 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className="flex items-center gap-1.5 min-w-0 cursor-pointer hover:text-primary"
                      onClick={() => onNavigateToFile?.(job.filePath)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          onNavigateToFile?.(job.filePath);
                        }
                      }}
                    >
                      <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium truncate">
                        {getFileName(job.filePath)}
                      </span>
                    </div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => handleCancel(job)}
                            disabled={cancellingId === job.id}
                          >
                            {cancellingId === job.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <X className="h-3 w-3" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">Cancel</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="truncate">{job.currentStep}</span>
                      <span className="flex-shrink-0 ml-2">
                        {formatElapsed(job.startedAt)}
                      </span>
                    </div>
                    <Progress value={job.progress} className="h-1.5" />
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {Math.round(job.progress)}%
                      </span>
                      {job.estimatedTimeRemaining !== undefined &&
                        job.estimatedTimeRemaining > 0 && (
                          <span className="text-muted-foreground">
                            ~{Math.ceil(job.estimatedTimeRemaining / 60)}m left
                          </span>
                        )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Interrupted Analyses */}
          {interruptedAnalyses.length > 0 && (
            <div className="p-2 space-y-2 border-t">
              <p className="text-xs font-medium text-amber-600 px-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Interrupted
              </p>
              {interruptedAnalyses.map((analysis) => (
                <div
                  key={analysis.filePath}
                  className="p-2 rounded-md border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
                      <span className="text-sm font-medium truncate">
                        {analysis.fileName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                              onClick={() => onRestartAnalysis?.(analysis)}
                            >
                              <Play className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="left">Resume</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() =>
                                handleDismissInterrupted(analysis.filePath)
                              }
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="left">Dismiss</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {Math.round(analysis.progressAtInterrupt)}% complete when
                    interrupted
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Recent Completed/Failed */}
          {recentJobs.length > 0 && (
            <div className="p-2 space-y-2 border-t">
              <p className="text-xs font-medium text-muted-foreground px-1">
                Recent
              </p>
              {recentJobs.map((job) => (
                <div
                  key={job.id}
                  className={cn(
                    "p-2 rounded-md border space-y-1",
                    job.status === "completed"
                      ? "border-green-200 bg-green-50/50 dark:bg-green-950/20"
                      : "border-red-200 bg-red-50/50 dark:bg-red-950/20",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className="flex items-center gap-1.5 min-w-0 cursor-pointer hover:text-primary"
                      onClick={() => onNavigateToFile?.(job.filePath)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          onNavigateToFile?.(job.filePath);
                        }
                      }}
                    >
                      {job.status === "completed" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-green-600" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 flex-shrink-0 text-red-600" />
                      )}
                      <span className="text-sm font-medium truncate">
                        {getFileName(job.filePath)}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => handleDismiss(job.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  {job.error && (
                    <p className="text-xs text-red-600 truncate">{job.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});
