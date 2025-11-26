"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Bug, Copy, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error);
    console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);

    this.setState({ errorInfo });

    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
  };

  private handleCopyError = () => {
    const { error, errorInfo } = this.state;
    const errorText = `
Error: ${error?.name || "Unknown"}
Message: ${error?.message || "No message"}
Stack: ${error?.stack || "No stack trace"}

Component Stack:
${errorInfo?.componentStack || "No component stack"}
    `.trim();

    navigator.clipboard.writeText(errorText);
    toast.success("Error details copied to clipboard");
  };

  private toggleDetails = () => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  public render() {
    if (this.state.hasError) {
      // Custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, errorInfo, showDetails } = this.state;

      return (
        <div className="flex items-center justify-center min-h-[400px] p-4">
          <Card className="w-full max-w-lg">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-8 w-8 text-destructive" />
              </div>
              <CardTitle className="text-xl">Something went wrong</CardTitle>
              <CardDescription>
                An unexpected error occurred in this part of the application.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Error summary */}
              <div className="rounded-lg bg-muted p-3">
                <p className="text-sm font-medium text-destructive">
                  {error?.name || "Error"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {error?.message || "An unknown error occurred"}
                </p>
              </div>

              {/* Collapsible error details */}
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between"
                  onClick={this.toggleDetails}
                >
                  <span className="flex items-center gap-2">
                    <Bug className="h-4 w-4" />
                    Technical Details
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${showDetails ? "rotate-180" : ""}`}
                  />
                </Button>
                {showDetails && (
                  <div className="mt-2 rounded-lg bg-black/90 p-3 text-xs font-mono text-green-400 max-h-48 overflow-auto">
                    <div className="mb-2">
                      <span className="text-gray-500">// Stack trace</span>
                    </div>
                    <pre className="whitespace-pre-wrap break-all">
                      {error?.stack || "No stack trace available"}
                    </pre>
                    {errorInfo?.componentStack && (
                      <>
                        <div className="mt-4 mb-2">
                          <span className="text-gray-500">
                            // Component stack
                          </span>
                        </div>
                        <pre className="whitespace-pre-wrap break-all">
                          {errorInfo.componentStack}
                        </pre>
                      </>
                    )}
                  </div>
                )}
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-2">
              <div className="flex gap-2 w-full">
                <Button
                  variant="outline"
                  onClick={this.handleReset}
                  className="flex-1"
                >
                  Try Again
                </Button>
                <Button onClick={this.handleReload} className="flex-1">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Reload App
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={this.handleCopyError}
                className="w-full"
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy Error Details
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * HOC to wrap a component with an error boundary
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  fallback?: ReactNode,
) {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  };
}
