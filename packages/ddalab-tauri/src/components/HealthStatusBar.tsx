"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/appStore";
import { ApiService } from "@/services/apiService";
import { useSync } from "@/hooks/useSync";
import { useHealthCheck } from "@/hooks/useHealthCheck";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Wifi,
  WifiOff,
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  RefreshCw,
  Server,
  Cloud,
  CloudOff,
  Brain,
  Loader2,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils";

interface HealthStatusBarProps {
  apiService: ApiService;
}

export function HealthStatusBar({ apiService }: HealthStatusBarProps) {
  const { ui, updateHealthStatus } = useAppStore();
  const { isConnected: syncConnected, isLoading: syncLoading } = useSync();
  const ddaRunning = useAppStore((state) => state.dda.isRunning);

  // Use TanStack Query for health checks with automatic polling
  const {
    data: healthData,
    isLoading: isCheckingHealth,
    refetch: refetchHealth,
  } = useHealthCheck(apiService, {
    enabled: ui.isServerReady,
    refetchInterval: 120 * 1000, // Poll every 2 minutes
  });

  // Sync health check results to Zustand store for backward compatibility
  useEffect(() => {
    if (!healthData) return;

    if (healthData.isHealthy) {
      updateHealthStatus({
        apiStatus: "healthy",
        lastCheck: healthData.timestamp,
        responseTime: healthData.responseTime,
        errors: [],
      });
    } else {
      updateHealthStatus((currentHealth) => ({
        apiStatus: "unhealthy",
        lastCheck: healthData.timestamp,
        responseTime: healthData.responseTime,
        errors: healthData.error
          ? [healthData.error, ...currentHealth.errors.slice(0, 4)]
          : currentHealth.errors,
      }));
    }
  }, [healthData, updateHealthStatus]);

  // Get health status from store (synced from query)
  const { health } = useAppStore();

  const getStatusColor = () => {
    if (isCheckingHealth) return "text-yellow-600";
    switch (health.apiStatus) {
      case "healthy":
        return "text-green-600";
      case "unhealthy":
        return "text-red-600";
      case "checking":
        return "text-yellow-600";
      default:
        return "text-gray-600";
    }
  };

  const getStatusIcon = () => {
    if (isCheckingHealth) return <RefreshCw className="h-4 w-4 animate-spin" />;
    switch (health.apiStatus) {
      case "healthy":
        return <CheckCircle className="h-4 w-4" />;
      case "unhealthy":
        return <AlertCircle className="h-4 w-4" />;
      case "checking":
        return <RefreshCw className="h-4 w-4 animate-spin" />;
      default:
        return <Server className="h-4 w-4" />;
    }
  };

  const formatResponseTime = (time: number) => {
    if (time < 1000) {
      return `${time}ms`;
    }
    return `${(time / 1000).toFixed(1)}s`;
  };

  return (
    <div className="border-t bg-background p-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center space-x-4">
          {/* API Status */}
          <div className="flex items-center space-x-2">
            <div className={`flex items-center space-x-1 ${getStatusColor()}`}>
              {getStatusIcon()}
              <span className="font-medium">API: {health.apiStatus}</span>
            </div>

            {health.responseTime > 0 && (
              <Badge variant="outline" className="text-xs">
                {formatResponseTime(health.responseTime)}
              </Badge>
            )}
          </div>

          {/* Sync Broker Status */}
          <div className="flex items-center space-x-1">
            {syncLoading ? (
              <RefreshCw className="h-4 w-4 text-yellow-600 animate-spin" />
            ) : syncConnected ? (
              <Cloud className="h-4 w-4 text-green-600" />
            ) : (
              <CloudOff className="h-4 w-4 text-gray-400" />
            )}
            <span
              className={
                syncConnected ? "text-green-600" : "text-muted-foreground"
              }
            >
              Sync:{" "}
              {syncLoading
                ? "connecting..."
                : syncConnected
                  ? "connected"
                  : "offline"}
            </span>
          </div>

          {/* DDA Analysis Status */}
          {ddaRunning && (
            <div
              className="flex items-center space-x-1 text-blue-600"
              title="DDA analysis is running in the background. You'll receive a notification when complete."
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>DDA: running</span>
            </div>
          )}

          {/* Last Check Time */}
          <div className="flex items-center space-x-1 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>
              Last: {formatDateTime(new Date(health.lastCheck).toISOString())}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Error Count */}
          {health.errors.length > 0 && (
            <Badge variant="destructive" className="text-xs">
              {health.errors.length} error{health.errors.length > 1 ? "s" : ""}
            </Badge>
          )}

          {/* Manual Refresh */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetchHealth()}
            disabled={isCheckingHealth}
            className="h-6 px-2"
          >
            <RefreshCw
              className={`h-3 w-3 ${isCheckingHealth ? "animate-spin" : ""}`}
            />
          </Button>

          {/* Activity Indicator */}
          <div className="flex items-center space-x-1">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <div className="flex space-x-1">
              {/* API Status Dot */}
              <div
                className={`w-2 h-2 rounded-full ${
                  health.apiStatus === "healthy"
                    ? "bg-green-500 animate-pulse"
                    : health.apiStatus === "checking"
                      ? "bg-yellow-500 animate-pulse"
                      : "bg-red-500"
                }`}
              />
              {/* Sync Broker Status Dot */}
              <div
                className={`w-2 h-2 rounded-full ${
                  syncConnected ? "bg-blue-500 animate-pulse" : "bg-gray-300"
                }`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Error Messages */}
      {health.errors.length > 0 && (
        <div className="mt-2 text-xs text-red-600">
          <div className="flex items-center space-x-1">
            <AlertCircle className="h-3 w-3" />
            <span>Latest error: {health.errors[0]}</span>
          </div>
        </div>
      )}
    </div>
  );
}
