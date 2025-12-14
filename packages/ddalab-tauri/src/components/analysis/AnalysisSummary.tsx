"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { AnalysisEstimation } from "@/hooks/useAnalysisEstimation";
import { Clock, Layers, Timer, TrendingUp } from "lucide-react";

export interface AnalysisSummaryProps {
  estimation: AnalysisEstimation;
  timeRange: number;
  className?: string;
}

export const AnalysisSummary: React.FC<AnalysisSummaryProps> = ({
  estimation,
  timeRange,
  className = "",
}) => {
  const { breakdown, estimatedTimeFormatted } = estimation;

  const summaryItems = [
    {
      icon: Layers,
      label: "Channels",
      value: breakdown.channelCount,
      description: "Unique channels to analyze",
    },
    {
      icon: Clock,
      label: "Time Range",
      value: `${timeRange.toFixed(1)}s`,
      description: "Duration of data",
    },
    {
      icon: TrendingUp,
      label: "Variants",
      value: breakdown.variantCount,
      description: "Analysis methods",
    },
    {
      icon: Timer,
      label: "Est. Time",
      value: estimatedTimeFormatted,
      description: `~${breakdown.totalOperations.toLocaleString()} operations`,
    },
  ];

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Analysis Summary</CardTitle>
        <CardDescription className="text-xs">
          Overview of your configured analysis
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {summaryItems.map((item) => (
            <div
              key={item.label}
              className="space-y-1 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
            >
              <div className="flex items-center gap-2">
                <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
                <Label className="text-xs text-muted-foreground">
                  {item.label}
                </Label>
              </div>
              <p className="text-lg font-semibold font-mono">{item.value}</p>
              <p className="text-xs text-muted-foreground">
                {item.description}
              </p>
            </div>
          ))}
        </div>

        {breakdown.totalOperations > 100000 && (
          <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900 rounded-lg">
            <p className="text-xs text-yellow-800 dark:text-yellow-200">
              <strong>Large Analysis:</strong> This configuration will perform{" "}
              {breakdown.totalOperations.toLocaleString()} operations. Consider
              reducing time range or number of variants for faster results.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
