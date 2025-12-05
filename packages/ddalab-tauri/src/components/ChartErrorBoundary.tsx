"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ChartError");

interface Props {
  children: ReactNode;
  /** Name of the chart for error reporting */
  chartName?: string;
  /** Optional custom fallback UI */
  fallback?: ReactNode;
  /** Callback when error occurs */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Minimum height for the error container */
  minHeight?: string | number;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Lightweight error boundary specifically designed for chart components.
 * Shows a minimal error UI that doesn't disrupt the overall layout.
 */
export class ChartErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const chartName = this.props.chartName || "Unknown Chart";

    logger.error(`Chart error in ${chartName}`, {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    this.props.onError?.(error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    const { hasError, error } = this.state;
    const { children, fallback, minHeight = 200, chartName } = this.props;

    if (hasError) {
      if (fallback) {
        return fallback;
      }

      return (
        <div
          className="flex flex-col items-center justify-center bg-muted/30 rounded-lg border border-dashed border-muted-foreground/25"
          style={{
            minHeight:
              typeof minHeight === "number" ? `${minHeight}px` : minHeight,
          }}
        >
          <AlertTriangle className="h-8 w-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground mb-1">
            {chartName
              ? `${chartName} failed to render`
              : "Chart failed to render"}
          </p>
          <p className="text-xs text-muted-foreground/75 mb-3 max-w-xs text-center">
            {error?.message || "An unexpected error occurred"}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={this.handleRetry}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      );
    }

    return children;
  }
}

/**
 * HOC to wrap a chart component with the chart-specific error boundary
 */
export function withChartErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  chartName?: string,
  minHeight?: string | number,
) {
  const displayName =
    WrappedComponent.displayName || WrappedComponent.name || "Component";

  function WithChartErrorBoundary(props: P) {
    return (
      <ChartErrorBoundary
        chartName={chartName || displayName}
        minHeight={minHeight}
      >
        <WrappedComponent {...props} />
      </ChartErrorBoundary>
    );
  }

  WithChartErrorBoundary.displayName = `withChartErrorBoundary(${displayName})`;

  return WithChartErrorBoundary;
}
