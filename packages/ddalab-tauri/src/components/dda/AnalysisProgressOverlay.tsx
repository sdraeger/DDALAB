/**
 * AnalysisProgressOverlay Component
 *
 * Full-screen overlay shown when DDA analysis is running.
 * Displays progress bar, status message, and cancel button.
 * Extracted from DDAAnalysis.tsx to reduce component complexity.
 */

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Cpu, RefreshCw, XCircle } from "lucide-react";

interface AnalysisProgressOverlayProps {
  isVisible: boolean;
  progress: number;
  statusMessage: string;
  estimatedTime: number;
  isCancelling: boolean;
  onCancel: () => void;
}

export const AnalysisProgressOverlay = memo(function AnalysisProgressOverlay({
  isVisible,
  progress,
  statusMessage,
  estimatedTime,
  isCancelling,
  onCancel,
}: AnalysisProgressOverlayProps) {
  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center animate-in fade-in-0 duration-200">
      <div className="text-center space-y-4 w-full max-w-md px-8">
        <Cpu className="h-12 w-12 animate-spin text-primary mx-auto" />
        <div>
          <p className="text-lg font-semibold">DDA Analysis Running</p>
          <p className="text-sm text-muted-foreground">
            {statusMessage || "Processing..."}
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Progress</span>
            <span className="font-medium text-primary">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} className="w-full h-2" />
          <p className="text-xs text-muted-foreground">
            ~{estimatedTime}s estimated • Configuration is locked
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isCancelling}
          className="mt-4"
        >
          {isCancelling ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Cancelling...
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 mr-2" />
              Cancel Analysis
            </>
          )}
        </Button>
      </div>
    </div>
  );
});
