import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ErrorState } from "@/components/ui/error-state";
import { CheckCircle2, Loader2, Play, Square, Zap } from "lucide-react";
import { TauriService } from "@/services/tauriService";
import {
  useApiStatusWithHealth,
  useStartLocalApiServer,
  useStopLocalApiServer,
} from "@/hooks/useApiStatus";

interface EmbeddedApiManagerProps {
  onApiReady?: (apiUrl: string) => void;
}

interface EmbeddedApiStatus {
  running: boolean;
  port: number;
  url?: string;
}

interface EmbeddedApiHealth {
  status: string;
  healthy: boolean;
  health?: any;
  error?: string;
}

export const EmbeddedApiManager: React.FC<EmbeddedApiManagerProps> = ({
  onApiReady,
}) => {
  // TanStack Query hooks
  const {
    status,
    health,
    isLoading: isCheckingStatus,
    refetchAll,
  } = useApiStatusWithHealth({
    refetchInterval: 10 * 1000, // Poll every 10 seconds
  });

  const startServerMutation = useStartLocalApiServer();
  const stopServerMutation = useStopLocalApiServer();

  const [error, setError] = useState<string | null>(null);

  // Auto-start server if not running (on mount)
  useEffect(() => {
    const autoStart = async () => {
      if (status && !status.running) {
        console.log("Local API not running, auto-starting...");
        try {
          await startServerMutation.mutateAsync();
        } catch (err) {
          console.error("Failed to auto-start server:", err);
        }
      }
    };

    // Small delay to ensure initial status check completes
    const timer = setTimeout(autoStart, 500);
    return () => clearTimeout(timer);
  }, [status?.running]);

  // Notify parent when API becomes ready
  useEffect(() => {
    if (status?.running && health?.healthy && status.url && onApiReady) {
      onApiReady(status.url);
    }
  }, [status, health, onApiReady]);

  const handleStartServer = async () => {
    try {
      setError(null);
      await startServerMutation.mutateAsync();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start local API server",
      );
    }
  };

  const handleStopServer = async () => {
    try {
      setError(null);
      await stopServerMutation.mutateAsync();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to stop local API server",
      );
    }
  };

  const isLoading =
    startServerMutation.isPending || stopServerMutation.isPending;

  const getStatusBadge = () => {
    if (!status?.running) {
      return (
        <Badge variant="outline" className="bg-gray-100 text-gray-700">
          Stopped
        </Badge>
      );
    }
    if (health?.healthy) {
      return (
        <Badge variant="outline" className="bg-green-100 text-green-700">
          Running
        </Badge>
      );
    }
    if (health?.status === "running") {
      return (
        <Badge variant="outline" className="bg-yellow-100 text-yellow-700">
          Starting...
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-gray-100 text-gray-700">
        Unknown
      </Badge>
    );
  };

  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-blue-500" />
              Embedded Rust API
              {getStatusBadge()}
            </CardTitle>
            <CardDescription>
              Lightweight built-in API server - No Docker required
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <ErrorState
            message={error}
            severity="error"
            variant="inline"
            onDismiss={() => setError(null)}
          />
        )}

        {status?.running && health?.healthy && (
          <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              <div className="font-medium">API server is running</div>
              <div className="text-sm mt-1">
                Available at:{" "}
                <code className="bg-green-100 dark:bg-green-900 px-1 py-0.5 rounded">
                  {status?.url || "http://localhost:8765"}
                </code>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {status?.running && !health?.healthy && (
          <Alert className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
            <Loader2 className="h-4 w-4 text-yellow-600 animate-spin" />
            <AlertDescription className="text-yellow-800 dark:text-yellow-200">
              Server is starting up, please wait...
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            <ul className="space-y-1.5 ml-1">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                <span>Fast startup - no dependencies</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                <span>Full EDF file reading and analysis</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                <span>Native performance</span>
              </li>
            </ul>
          </div>

          <div className="flex gap-2 pt-2">
            {!status?.running ? (
              <Button
                onClick={handleStartServer}
                disabled={isLoading}
                className="flex-1"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Start Embedded API
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={handleStopServer}
                disabled={isLoading}
                variant="destructive"
                className="flex-1"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Stopping...
                  </>
                ) : (
                  <>
                    <Square className="h-4 w-4 mr-2" />
                    Stop Server
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
