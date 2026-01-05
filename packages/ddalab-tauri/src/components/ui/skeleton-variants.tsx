"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Hook to delay showing loading state to prevent flash on fast networks.
 * Only shows loading after the specified delay has passed.
 */
export function useDelayedLoading(
  isLoading: boolean,
  delayMs: number = 200,
): boolean {
  const [showLoading, setShowLoading] = React.useState(false);

  React.useEffect(() => {
    if (!isLoading) {
      setShowLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      setShowLoading(true);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [isLoading, delayMs]);

  return showLoading;
}

/**
 * Wrapper component that delays showing skeleton content to prevent flash.
 * Only renders skeleton if loading takes longer than the delay.
 */
export function DelayedSkeleton({
  isLoading,
  delay = 200,
  children,
  skeleton,
}: {
  isLoading: boolean;
  delay?: number;
  children: React.ReactNode;
  skeleton: React.ReactNode;
}) {
  const showSkeleton = useDelayedLoading(isLoading, delay);

  if (!isLoading) {
    return <>{children}</>;
  }

  // During the delay period, show nothing or a minimal placeholder
  if (!showSkeleton) {
    return null;
  }

  return <>{skeleton}</>;
}

// Base skeleton with shimmer animation
// Uses motion-safe variants to respect prefers-reduced-motion
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md bg-muted relative overflow-hidden",
        // Pulse animation - only when motion is allowed
        "motion-safe:animate-pulse",
        // Shimmer effect - only when motion is allowed
        "after:absolute after:inset-0 after:-translate-x-full",
        "motion-safe:after:animate-[shimmer_2s_infinite]",
        "after:bg-gradient-to-r after:from-transparent after:via-white/10 after:to-transparent",
        // When motion is reduced, just show a static background
        "motion-reduce:bg-muted/80",
        className,
      )}
      {...props}
    />
  );
}

// Line skeleton for text
export function SkeletonLine({
  width = "100%",
  className,
}: {
  width?: string | number;
  className?: string;
}) {
  return (
    <Skeleton
      className={cn("h-4", className)}
      style={{ width: typeof width === "number" ? `${width}%` : width }}
    />
  );
}

// Circle skeleton for avatars
export function SkeletonCircle({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Skeleton
      className={cn("rounded-full", className)}
      style={{ width: size, height: size }}
    />
  );
}

// Rectangle skeleton for images/cards
export function SkeletonRect({
  width = "100%",
  height = 100,
  className,
}: {
  width?: string | number;
  height?: number;
  className?: string;
}) {
  return (
    <Skeleton
      className={className}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height,
      }}
    />
  );
}

// Table row skeleton
export function SkeletonTableRow({
  columns = 4,
  className,
}: {
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-4 py-3", className)}>
      {Array.from({ length: columns }).map((_, i) => (
        <SkeletonLine
          key={i}
          width={i === 0 ? 30 : Math.random() * 40 + 40}
          className="h-4"
        />
      ))}
    </div>
  );
}

// Card skeleton
export function SkeletonCard({
  hasImage = true,
  lines = 3,
  className,
}: {
  hasImage?: boolean;
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card p-4 space-y-4", className)}>
      {hasImage && <SkeletonRect height={120} className="rounded-md" />}
      <div className="space-y-2">
        <SkeletonLine width={60} className="h-5" />
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine
            key={i}
            width={Math.random() * 30 + 70}
            className="h-3"
          />
        ))}
      </div>
    </div>
  );
}

// List item skeleton
export function SkeletonListItem({
  hasAvatar = false,
  hasAction = false,
  className,
}: {
  hasAvatar?: boolean;
  hasAction?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 py-2 px-3", className)}>
      {hasAvatar && <SkeletonCircle size={32} />}
      <div className="flex-1 space-y-1.5">
        <SkeletonLine width={Math.random() * 30 + 50} className="h-4" />
        <SkeletonLine width={Math.random() * 20 + 30} className="h-3" />
      </div>
      {hasAction && <Skeleton className="h-8 w-8 rounded" />}
    </div>
  );
}

// File tree item skeleton
export function SkeletonFileItem({
  depth = 0,
  className,
}: {
  depth?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-center gap-2 py-1.5", className)}
      style={{ paddingLeft: depth * 16 + 8 }}
    >
      <Skeleton className="h-4 w-4 rounded" />
      <SkeletonLine width={Math.random() * 40 + 60} className="h-4" />
    </div>
  );
}

// File list skeleton
export function SkeletonFileList({
  count = 5,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonFileItem key={i} depth={Math.floor(Math.random() * 2)} />
      ))}
    </div>
  );
}

// Plot skeleton
export function SkeletonPlot({
  height = 200,
  className,
}: {
  height?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <SkeletonLine width={120} className="h-5" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      </div>
      <SkeletonRect height={height} className="rounded-lg" />
      <div className="flex justify-center gap-4">
        <SkeletonLine width={60} className="h-3" />
        <SkeletonLine width={60} className="h-3" />
        <SkeletonLine width={60} className="h-3" />
      </div>
    </div>
  );
}

// Analysis result skeleton
export function SkeletonAnalysisResult({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <SkeletonLine width={200} className="h-6" />
          <SkeletonLine width={150} className="h-4" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-9 rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <SkeletonCard hasImage={false} lines={2} />
        <SkeletonCard hasImage={false} lines={2} />
        <SkeletonCard hasImage={false} lines={2} />
      </div>
      <SkeletonPlot height={300} />
    </div>
  );
}

// Settings section skeleton
export function SkeletonSettings({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-3">
          <SkeletonLine width={120} className="h-5" />
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, j) => (
              <div
                key={j}
                className="flex items-center justify-between py-2 border-b"
              >
                <div className="space-y-1">
                  <SkeletonLine
                    width={Math.random() * 50 + 100}
                    className="h-4"
                  />
                  <SkeletonLine
                    width={Math.random() * 100 + 150}
                    className="h-3"
                  />
                </div>
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// OpenNeuro dataset card skeleton
export function SkeletonDatasetCard({ className }: { className?: string }) {
  return (
    <div className={cn("p-4 border rounded-lg", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-2">
          {/* Dataset ID */}
          <SkeletonLine width={100} className="h-5" />
          {/* Dataset name */}
          <SkeletonLine width="70%" className="h-4" />
          {/* Badges row */}
          <div className="flex items-center gap-2 mt-3">
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-10 rounded-full" />
            <div className="flex items-center gap-1">
              <Skeleton className="h-3 w-3 rounded" />
              <SkeletonLine width={60} className="h-3" />
            </div>
          </div>
        </div>
        {/* External link button */}
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
    </div>
  );
}

// OpenNeuro dataset list skeleton
export function SkeletonDatasetList({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonDatasetCard key={i} />
      ))}
    </div>
  );
}

// Add shimmer keyframe to global styles
export const shimmerKeyframes = `
@keyframes shimmer {
  100% {
    transform: translateX(100%);
  }
}
`;
