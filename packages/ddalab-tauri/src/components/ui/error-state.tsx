"use client";

import React from "react";
import { AlertCircle, RefreshCw, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export type ErrorSeverity = "error" | "warning" | "info";

export interface ErrorStateProps {
  /** Error message to display */
  message: string;
  /** Optional title for the error */
  title?: string;
  /** Severity level affects styling */
  severity?: ErrorSeverity;
  /** Called when retry button is clicked */
  onRetry?: () => void;
  /** Called when dismiss button is clicked */
  onDismiss?: () => void;
  /** Whether retry is in progress */
  isRetrying?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Render as compact inline or full block */
  variant?: "inline" | "block" | "toast";
}

const severityConfig: Record<
  ErrorSeverity,
  { icon: React.ElementType; colors: string; bgColors: string }
> = {
  error: {
    icon: XCircle,
    colors: "text-red-600 dark:text-red-400",
    bgColors: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900",
  },
  warning: {
    icon: AlertTriangle,
    colors: "text-yellow-600 dark:text-yellow-400",
    bgColors:
      "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-900",
  },
  info: {
    icon: AlertCircle,
    colors: "text-blue-600 dark:text-blue-400",
    bgColors:
      "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900",
  },
};

/**
 * Standardized error state component.
 * Use this for consistent error display throughout the app.
 */
export function ErrorState({
  message,
  title,
  severity = "error",
  onRetry,
  onDismiss,
  isRetrying = false,
  className,
  variant = "block",
}: ErrorStateProps) {
  const config = severityConfig[severity];
  const Icon = config.icon;

  if (variant === "inline") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-sm",
          config.colors,
          className,
        )}
      >
        <Icon className="h-4 w-4 flex-shrink-0" />
        <span className="truncate">{message}</span>
        {onRetry && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRetry}
            disabled={isRetrying}
            className="h-6 px-2"
          >
            <RefreshCw
              className={cn("h-3 w-3", isRetrying && "animate-spin")}
            />
          </Button>
        )}
      </div>
    );
  }

  if (variant === "toast") {
    return (
      <Alert
        variant="destructive"
        className={cn("border", config.bgColors, className)}
      >
        <Icon className={cn("h-4 w-4", config.colors)} />
        {title && <AlertTitle className={config.colors}>{title}</AlertTitle>}
        <AlertDescription className="flex items-center justify-between">
          <span>{message}</span>
          <div className="flex gap-2">
            {onRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={isRetrying}
              >
                <RefreshCw
                  className={cn("h-3 w-3 mr-1", isRetrying && "animate-spin")}
                />
                Retry
              </Button>
            )}
            {onDismiss && (
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  // Block variant (default)
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-6 text-center rounded-lg border",
        config.bgColors,
        className,
      )}
    >
      <Icon className={cn("h-12 w-12 mb-4", config.colors)} />
      {title && (
        <h3 className={cn("text-lg font-semibold mb-2", config.colors)}>
          {title}
        </h3>
      )}
      <p className="text-muted-foreground mb-4 max-w-md">{message}</p>
      <div className="flex gap-2">
        {onRetry && (
          <Button variant="outline" onClick={onRetry} disabled={isRetrying}>
            <RefreshCw
              className={cn("h-4 w-4 mr-2", isRetrying && "animate-spin")}
            />
            {isRetrying ? "Retrying..." : "Try Again"}
          </Button>
        )}
        {onDismiss && (
          <Button variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Loading state with error handling.
 * Shows loading, error, or children based on state.
 */
export function LoadingErrorState({
  isLoading,
  error,
  onRetry,
  loadingComponent,
  children,
  className,
}: {
  isLoading: boolean;
  error?: Error | string | null;
  onRetry?: () => void;
  loadingComponent?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  if (isLoading) {
    return <>{loadingComponent}</>;
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return (
      <ErrorState
        message={errorMessage}
        title="Something went wrong"
        onRetry={onRetry}
        className={className}
      />
    );
  }

  return <>{children}</>;
}

/**
 * Error boundary wrapper with fallback UI.
 */
export class ErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    fallback?: React.ReactNode;
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: {
    children: React.ReactNode;
    fallback?: React.ReactNode;
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorState
          title="Something went wrong"
          message={this.state.error?.message ?? "An unexpected error occurred"}
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      );
    }

    return this.props.children;
  }
}
