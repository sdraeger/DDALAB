"use client";

import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { parseBIDSPath, getModalityColor } from "@/utils/bidsParser";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Database,
  User,
  Calendar,
  Play,
  Hash,
  FileText,
  ChevronRight,
  Brain,
  Activity,
  Cpu,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface BIDSContextIndicatorProps {
  /** Variant: 'full' shows all details, 'compact' shows abbreviated version */
  variant?: "full" | "compact" | "breadcrumb";
  /** Additional CSS classes */
  className?: string;
}

/**
 * Displays the current BIDS context (dataset, subject, session, task, run)
 * prominently to help users understand what data they're viewing.
 */
export function BIDSContextIndicator({
  variant = "full",
  className = "",
}: BIDSContextIndicatorProps) {
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);
  const navigateToFile = useAppStore((state) => state.navigateToFile);

  const bidsInfo = useMemo(() => {
    return parseBIDSPath(selectedFile?.file_path || "");
  }, [selectedFile?.file_path]);

  const handleRevealInFileBrowser = () => {
    if (selectedFile?.file_path) {
      navigateToFile(selectedFile.file_path);
    }
  };

  if (!selectedFile) {
    return (
      <div className={`text-muted-foreground text-sm ${className}`}>
        No file selected
      </div>
    );
  }

  if (!bidsInfo.isBIDS) {
    // Non-BIDS file - just show filename with reveal button
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium truncate max-w-[300px]">
          {selectedFile.file_name}
        </span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 ml-1"
                onClick={handleRevealInFileBrowser}
                aria-label="Reveal in File Browser"
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reveal in File Browser</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  // Get modality icon
  const ModalityIcon = getModalityIcon(bidsInfo.modality);
  const modalityColorClass = getModalityColor(bidsInfo.modality);

  if (variant === "compact") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`flex items-center gap-1.5 bg-muted/50 rounded-md px-2 py-1 ${className}`}
            >
              <ModalityIcon className={`h-3.5 w-3.5 ${modalityColorClass}`} />
              <span className="text-xs font-medium">
                {bidsInfo.shortDisplay}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="space-y-1">
              <p className="font-medium">{bidsInfo.displayString}</p>
              <p className="text-xs text-muted-foreground">
                {selectedFile.file_path}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (variant === "breadcrumb") {
    return (
      <div className={`flex items-center gap-1 text-sm ${className}`}>
        {bidsInfo.datasetName && (
          <>
            <Database className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">
              {bidsInfo.datasetName}
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
          </>
        )}
        {bidsInfo.subjectId && (
          <>
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">Sub-{bidsInfo.subjectId}</span>
            {(bidsInfo.sessionId || bidsInfo.taskName) && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
            )}
          </>
        )}
        {bidsInfo.sessionId && (
          <>
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Ses-{bidsInfo.sessionId}</span>
            {bidsInfo.taskName && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
            )}
          </>
        )}
        {bidsInfo.taskName && (
          <>
            <Play className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{bidsInfo.taskName}</span>
            {bidsInfo.runNumber && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
            )}
          </>
        )}
        {bidsInfo.runNumber && (
          <>
            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Run {bidsInfo.runNumber}</span>
          </>
        )}
        {bidsInfo.modality && (
          <Badge
            variant="secondary"
            className={`ml-2 text-xs ${modalityColorClass}`}
          >
            {bidsInfo.modality.toUpperCase()}
          </Badge>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 ml-2"
                onClick={handleRevealInFileBrowser}
                aria-label="Reveal in File Browser"
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reveal in File Browser</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  // Full variant - card-like display
  return (
    <div
      className={`flex items-center gap-3 bg-gradient-to-r from-muted/80 to-muted/30 rounded-lg px-4 py-2 border border-border/50 ${className}`}
    >
      {/* Modality Icon */}
      <div
        className={`flex items-center justify-center w-10 h-10 rounded-lg bg-background/80 ${modalityColorClass}`}
      >
        <ModalityIcon className="h-5 w-5" />
      </div>

      {/* Main Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Dataset */}
          {bidsInfo.datasetName && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="gap-1">
                    <Database className="h-3 w-3" />
                    {bidsInfo.datasetName}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>Dataset</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Subject */}
          {bidsInfo.subjectId && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="gap-1 font-semibold">
                    <User className="h-3 w-3" />
                    Subject {bidsInfo.subjectId}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>Subject ID</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Session */}
          {bidsInfo.sessionId && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="gap-1">
                    <Calendar className="h-3 w-3" />
                    Session {bidsInfo.sessionId}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>Session</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Task */}
          {bidsInfo.taskName && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge className="gap-1 bg-primary/90">
                    <Play className="h-3 w-3" />
                    {bidsInfo.taskName}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>Task</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Run */}
          {bidsInfo.runNumber && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="gap-1">
                    <Hash className="h-3 w-3" />
                    Run {bidsInfo.runNumber}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>Run Number</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Modality Badge */}
          {bidsInfo.modality && (
            <Badge variant="secondary" className={modalityColorClass}>
              {bidsInfo.modality.toUpperCase()}
            </Badge>
          )}
        </div>

        {/* File path (truncated) */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-xs text-muted-foreground truncate mt-1 max-w-md cursor-help">
                {selectedFile.file_name}
              </p>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-lg">
              <p className="font-mono text-xs break-all">
                {selectedFile.file_path}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Quick Stats */}
      {selectedFile.duration !== undefined && selectedFile.duration > 0 && (
        <div className="text-right text-xs text-muted-foreground">
          <div>{formatDuration(selectedFile.duration)}</div>
          <div>{selectedFile.channels?.length || 0} channels</div>
        </div>
      )}

      {/* Reveal in File Browser */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={handleRevealInFileBrowser}
            >
              <FolderOpen className="h-4 w-4" />
              <span className="hidden sm:inline">Reveal</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Reveal in File Browser - jump to this file&apos;s location
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

/**
 * Get the appropriate icon for the modality
 */
function getModalityIcon(modality?: string) {
  switch (modality?.toLowerCase()) {
    case "eeg":
      return Activity;
    case "meg":
      return Brain;
    case "ieeg":
      return Cpu;
    default:
      return FileText;
  }
}

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export default BIDSContextIndicator;
