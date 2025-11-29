"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useAppStore } from "@/store/appStore";
import { ApiService } from "@/services/apiService";
import { useSync } from "@/hooks/useSync";
import { useHealthCheck } from "@/hooks/useHealthCheck";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  X,
  FlaskConical,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils";

interface HealthStatusBarProps {
  apiService: ApiService;
}

export function HealthStatusBar({ apiService }: HealthStatusBarProps) {
  const { ui, updateHealthStatus } = useAppStore();
  const { isConnected: syncConnected, isLoading: syncLoading } = useSync();
  const ddaRunning = useAppStore((state) => state.dda.isRunning);
  const setDDARunning = useAppStore((state) => state.setDDARunning);
  const expertMode = useAppStore((state) => state.ui.expertMode);
  const setExpertMode = useAppStore((state) => state.setExpertMode);

  // Cancel popover state
  const [showCancelPopover, setShowCancelPopover] = useState(false);
  const [isPopoverClosing, setIsPopoverClosing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const cancelPopoverRef = useRef<HTMLDivElement>(null);

  // Handle smooth close animation
  const closePopover = useCallback(() => {
    setIsPopoverClosing(true);
    // Wait for animation to complete before hiding
    setTimeout(() => {
      setShowCancelPopover(false);
      setIsPopoverClosing(false);
    }, 150); // Match animation duration
  }, []);

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        cancelPopoverRef.current &&
        !cancelPopoverRef.current.contains(event.target as Node)
      ) {
        closePopover();
      }
    }

    if (showCancelPopover && !isPopoverClosing) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showCancelPopover, isPopoverClosing, closePopover]);

  // Handle cancel DDA analysis
  const handleCancelDDA = useCallback(async () => {
    setIsCancelling(true);
    try {
      const result = await apiService.cancelDDAAnalysis();
      if (result.success) {
        console.log(
          "[HealthStatusBar] DDA analysis cancelled:",
          result.cancelled_analysis_id,
        );
        // Update the DDA running state
        setDDARunning(false);
      } else {
        console.warn("[HealthStatusBar] Failed to cancel DDA:", result.message);
      }
    } catch (error) {
      console.error("[HealthStatusBar] Error cancelling DDA:", error);
    } finally {
      setIsCancelling(false);
      closePopover();
    }
  }, [apiService, setDDARunning, closePopover]);

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

          {/* DDA Analysis Status with Cancel Popover */}
          {ddaRunning && (
            <div className="relative" ref={cancelPopoverRef}>
              <button
                onClick={() => {
                  if (showCancelPopover) {
                    closePopover();
                  } else {
                    setShowCancelPopover(true);
                  }
                }}
                className="flex items-center space-x-1 text-blue-600 hover:text-blue-700 transition-colors cursor-pointer"
                title="Click to cancel"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>DDA: running</span>
              </button>

              {/* Cancel Popover */}
              {showCancelPopover && (
                <div className="absolute bottom-full left-0 mb-2 z-50">
                  <div
                    className={`bg-popover border rounded-md shadow-lg px-3 py-2 text-sm transition-all duration-150 ${
                      isPopoverClosing
                        ? "animate-out fade-out-0 zoom-out-95 slide-out-to-bottom-2"
                        : "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      {isCancelling ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          <span className="text-muted-foreground">
                            Cancelling...
                          </span>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={handleCancelDDA}
                            className="text-red-600 hover:text-red-700 hover:underline font-medium transition-colors"
                          >
                            Cancel?
                          </button>
                          <button
                            onClick={closePopover}
                            className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                    {/* Small arrow pointing down */}
                    <div className="absolute left-4 -bottom-1 w-2 h-2 bg-popover border-r border-b rotate-45 transform" />
                  </div>
                </div>
              )}
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
          {/* Expert Mode Toggle */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center space-x-1.5 px-2 py-1 rounded-md hover:bg-accent/50 transition-colors">
                  <FlaskConical
                    className={`h-3.5 w-3.5 ${expertMode ? "text-primary" : "text-muted-foreground"}`}
                  />
                  <span
                    className={`text-xs font-medium ${expertMode ? "text-primary" : "text-muted-foreground"}`}
                  >
                    Expert
                  </span>
                  <Switch
                    checked={expertMode}
                    onCheckedChange={setExpertMode}
                    className="h-4 w-7 data-[state=checked]:bg-primary"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="font-medium">
                  {expertMode ? "Expert Mode Enabled" : "Expert Mode Disabled"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {expertMode
                    ? "Advanced DDA options visible"
                    : "Using EEG defaults (delays: [7, 10], MODEL: 1 2 10)"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className="w-px h-4 bg-border" />

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
