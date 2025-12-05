"use client";

import { useAppStore } from "@/store/appStore";
import { useDDAProgress } from "@/hooks/useDDAAnalysis";
import { Brain, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

export function DDAProgressIndicator() {
  const isRunning = useAppStore((state) => state.dda.isRunning);
  const currentAnalysisId = useAppStore(
    (state) => state.dda.currentAnalysis?.id,
  );

  // Get progress from the hook (it listens to Tauri events)
  const progressEvent = useDDAProgress(currentAnalysisId, isRunning);

  if (!isRunning) {
    return null;
  }

  const progress = progressEvent?.progress_percent || 0;
  const currentStep = progressEvent?.current_step || "Initializing analysis...";
  const phase = progressEvent?.phase || "preprocessing";

  return (
    <div className="fixed bottom-4 right-4 bg-background border border-border rounded-lg shadow-lg p-4 w-96 z-50">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-1">
          <Loader2 className="h-5 w-5 text-primary animate-spin" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Brain className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">DDA Analysis Running</span>
            <Badge variant="secondary" className="text-xs">
              {phase}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3 truncate">
            {currentStep}
          </p>
          <div className="space-y-1">
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{Math.round(progress)}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
