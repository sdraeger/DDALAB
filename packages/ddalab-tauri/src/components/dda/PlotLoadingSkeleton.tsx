"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

interface PlotLoadingSkeletonProps {
  height?: number;
  title?: string;
  progress?: number; // Optional progress 0-100
}

export const PlotLoadingSkeleton: React.FC<PlotLoadingSkeletonProps> = ({
  height = 500,
  title = "Loading visualization...",
  progress,
}) => {
  return (
    <Card className="relative overflow-hidden">
      {/* Shimmer effect overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
      <CardContent className="p-4 relative z-10">
        <div
          className="flex flex-col items-center justify-center bg-muted/20 rounded-md border-2 border-dashed border-muted backdrop-blur-sm"
          style={{ height: `${height}px` }}
        >
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
          <p className="text-sm font-medium text-muted-foreground">{title}</p>

          {/* Progress bar if provided */}
          {progress !== undefined && (
            <div className="mt-4 w-48 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          )}

          {/* Skeleton bars with staggered animation */}
          <div className="mt-4 space-y-2 w-3/4 max-w-md">
            <div
              className="h-2 bg-muted/50 rounded animate-pulse"
              style={{ animationDelay: "0ms" }}
            />
            <div
              className="h-2 bg-muted/40 rounded animate-pulse"
              style={{ width: "80%", animationDelay: "150ms" }}
            />
            <div
              className="h-2 bg-muted/30 rounded animate-pulse"
              style={{ width: "60%", animationDelay: "300ms" }}
            />
          </div>
        </div>
      </CardContent>

      <style jsx>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </Card>
  );
};
