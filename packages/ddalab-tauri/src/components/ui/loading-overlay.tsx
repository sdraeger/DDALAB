"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "./progress";

interface LoadingOverlayProps {
  /** Whether the overlay is visible */
  isLoading: boolean;
  /** Main loading message */
  message?: string;
  /** Secondary description text */
  description?: string;
  /** Progress value (0-100) - shows progress bar if provided */
  progress?: number;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Whether to show a backdrop (darkens content behind) */
  backdrop?: boolean;
  /** Whether the overlay is fullscreen or contained */
  fullscreen?: boolean;
  /** Custom className */
  className?: string;
  /** Children to render behind the overlay */
  children?: React.ReactNode;
}

/**
 * Standardized loading overlay component.
 * Use this consistently across the app for async operations.
 *
 * @example
 * ```tsx
 * // Simple loading
 * <LoadingOverlay isLoading={isLoading} message="Loading files..." />
 *
 * // With progress
 * <LoadingOverlay
 *   isLoading={isLoading}
 *   message="Analyzing data..."
 *   progress={75}
 * />
 *
 * // Wrapping content
 * <LoadingOverlay isLoading={isLoading} message="Saving...">
 *   <YourContent />
 * </LoadingOverlay>
 * ```
 */
export function LoadingOverlay({
  isLoading,
  message = "Loading...",
  description,
  progress,
  size = "md",
  backdrop = true,
  fullscreen = false,
  className,
  children,
}: LoadingOverlayProps) {
  const sizeClasses = {
    sm: {
      spinner: "h-6 w-6",
      message: "text-sm",
      description: "text-xs",
      progress: "w-32",
    },
    md: {
      spinner: "h-8 w-8",
      message: "text-base",
      description: "text-sm",
      progress: "w-48",
    },
    lg: {
      spinner: "h-12 w-12",
      message: "text-lg",
      description: "text-base",
      progress: "w-64",
    },
  };

  const sizes = sizeClasses[size];

  if (!isLoading && children) {
    return <>{children}</>;
  }

  if (!isLoading) {
    return null;
  }

  const overlayContent = (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3",
        fullscreen ? "min-h-screen" : "min-h-[200px] py-8",
      )}
      role="status"
      aria-busy="true"
      aria-label={message}
    >
      <Loader2
        className={cn(sizes.spinner, "animate-spin text-primary")}
        aria-hidden="true"
      />
      <div className="text-center">
        <p className={cn(sizes.message, "font-medium text-foreground")}>
          {message}
        </p>
        {description && (
          <p className={cn(sizes.description, "text-muted-foreground mt-1")}>
            {description}
          </p>
        )}
      </div>
      {progress !== undefined && (
        <div className={cn(sizes.progress, "mt-2")}>
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-muted-foreground text-center mt-1">
            {Math.round(progress)}%
          </p>
        </div>
      )}
    </div>
  );

  if (children) {
    return (
      <div className={cn("relative", className)}>
        <div
          className={cn(
            "transition-opacity duration-200 ease-out",
            isLoading && "opacity-50 pointer-events-none",
          )}
        >
          {children}
        </div>
        {isLoading && (
          <div
            className={cn(
              "absolute inset-0 flex items-center justify-center",
              "animate-in fade-in-0 duration-200",
              backdrop && "bg-background/80 backdrop-blur-sm",
            )}
          >
            {overlayContent}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "animate-in fade-in-0 duration-200",
        backdrop && "bg-background/80",
        fullscreen && "fixed inset-0 z-50",
        className,
      )}
    >
      {overlayContent}
    </div>
  );
}

/**
 * Inline loading indicator for smaller contexts.
 * Use for inline button states or small loading areas.
 */
interface InlineLoadingProps {
  message?: string;
  className?: string;
}

export function InlineLoading({
  message = "Loading...",
  className,
}: InlineLoadingProps) {
  return (
    <div
      className={cn("flex items-center gap-2 text-muted-foreground", className)}
      role="status"
      aria-busy="true"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

/**
 * Loading placeholder that fills its container.
 * Use as a drop-in replacement while content loads.
 */
interface LoadingPlaceholderProps {
  message?: string;
  className?: string;
  minHeight?: string;
}

export function LoadingPlaceholder({
  message = "Loading...",
  className,
  minHeight = "200px",
}: LoadingPlaceholderProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-muted-foreground",
        className,
      )}
      style={{ minHeight }}
      role="status"
      aria-busy="true"
    >
      <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
