/**
 * AnalysisStatusCard Component
 *
 * Displays the status of the current DDA analysis with progress indicator.
 * Shows different states: running, loading results, completed, error.
 * Extracted from DDAAnalysis.tsx to reduce component complexity.
 */

import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Cpu, RefreshCw, CheckCircle, AlertCircle, Clock } from "lucide-react";

type AnalysisState = "running" | "loading" | "completed" | "error" | "idle";

interface AnalysisStatusCardProps {
  state: AnalysisState;
  statusMessage: string;
  progress: number;
  estimatedTime: number;
  error: string | null;
}

function getStatusIcon(state: AnalysisState) {
  switch (state) {
    case "running":
      return <Cpu className="h-4 w-4 animate-spin text-blue-600" />;
    case "loading":
      return <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />;
    case "completed":
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    case "error":
      return <AlertCircle className="h-4 w-4 text-red-600" />;
    default:
      return null;
  }
}

function getStatusMessage(state: AnalysisState, statusMessage: string): string {
  switch (state) {
    case "loading":
      return "Loading previous analysis results...";
    case "running":
    case "completed":
      return statusMessage;
    default:
      return statusMessage;
  }
}

export const AnalysisStatusCard = memo(function AnalysisStatusCard({
  state,
  statusMessage,
  progress,
  estimatedTime,
  error,
}: AnalysisStatusCardProps) {
  if (state === "idle") return null;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {getStatusIcon(state)}
              <span className="text-sm font-medium">
                {getStatusMessage(state, statusMessage)}
              </span>
            </div>
            {state === "running" && (
              <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>~{estimatedTime}s estimated</span>
              </div>
            )}
          </div>

          {state === "running" && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Processing...</span>
                <span className="font-medium">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="w-full" />
            </div>
          )}

          {error && (
            <div className="flex items-center space-x-2 text-red-600">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
