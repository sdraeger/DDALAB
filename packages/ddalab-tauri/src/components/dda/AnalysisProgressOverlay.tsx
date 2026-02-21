import { memo } from "react";
import { Button } from "@/components/ui/button";
import { RadialProgress } from "@/components/ui/stat-card";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface AnalysisProgressOverlayProps {
  isVisible: boolean;
  progress: number;
  statusMessage: string;
  estimatedTime: number;
  isCancelling: boolean;
  onCancel: () => void;
}

function StageStep({
  label,
  completed,
  active,
}: {
  label: string;
  completed: boolean;
  active: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs",
        active && "text-primary font-medium",
        completed && "text-green-600 dark:text-green-400",
        !active && !completed && "text-muted-foreground",
      )}
    >
      {completed ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            active ? "bg-primary animate-pulse" : "bg-muted-foreground/30",
          )}
        />
      )}
      {label}
    </div>
  );
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
      <div className="text-center space-y-6 w-full max-w-md px-8">
        <RadialProgress value={progress} size={140} strokeWidth={10}>
          <div className="text-center">
            <span className="text-3xl font-bold">{Math.round(progress)}%</span>
            <p className="text-xs text-muted-foreground mt-0.5">Processing</p>
          </div>
        </RadialProgress>

        <div>
          <p className="text-lg font-semibold">DDA Analysis Running</p>
          <p className="text-sm text-muted-foreground">
            {statusMessage || "Processing..."}
          </p>
        </div>

        <div className="flex items-center justify-center gap-3">
          <StageStep
            label="Initializing"
            completed={progress > 0}
            active={progress === 0}
          />
          <div className="h-px w-6 bg-muted" />
          <StageStep
            label="Processing"
            completed={progress >= 95}
            active={progress > 0 && progress < 95}
          />
          <div className="h-px w-6 bg-muted" />
          <StageStep
            label="Finalizing"
            completed={progress >= 100}
            active={progress >= 95 && progress < 100}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          ~{estimatedTime}s estimated
        </p>

        <Button
          variant="destructive"
          onClick={onCancel}
          disabled={isCancelling}
          className="mt-2"
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
