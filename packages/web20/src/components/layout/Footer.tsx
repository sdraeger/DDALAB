"use client";

import React from "react";
import { useAppDispatch, useFooterVisible } from "@/store/hooks";
import { toggleFooter } from "@/store/slices/userSlice";
import { Activity, Wifi, Database, EyeOff, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";
import {
  useSystemStatus,
  formatUptime,
  getStatusColor,
} from "@/hooks/useSystemStatus";

export function Footer() {
  const dispatch = useAppDispatch();
  const footerVisible = useFooterVisible();
  const { systemStatus, isLoading, error } = useSystemStatus({
    refreshInterval: 3000, // Update every 5 seconds
    enabled: footerVisible, // Only fetch when footer is visible
  });

  if (!footerVisible) return null;

  return (
    <footer className="flex h-12 items-center justify-between border-t bg-background px-4 text-sm">
      <div className="flex items-center gap-4">
        {error ? (
          <div className="flex items-center gap-2 text-red-500">
            <AlertTriangle className="h-3 w-3" />
            <span className="text-xs">Status unavailable</span>
          </div>
        ) : isLoading ? (
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-gray-400 animate-pulse" />
            <span className="text-muted-foreground text-xs">Loading...</span>
          </div>
        ) : systemStatus ? (
          <>
            {/* Status Indicators */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <div
                  className={`h-2 w-2 rounded-full ${getStatusColor(systemStatus.status)}`}
                />
                <span className="text-muted-foreground capitalize">
                  {systemStatus.status}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <Wifi className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground capitalize">
                  {systemStatus.network_status}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <Database className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">
                  DB: {systemStatus.db_status}
                </span>
              </div>
            </div>

            {/* System Status */}
            <div className="flex items-center gap-2">
              <Activity className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">
                CPU: {systemStatus.cpu_percent}%
              </span>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">
                Memory: {systemStatus.memory_percent}%
              </span>
              {systemStatus.uptime_seconds > 0 && (
                <>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-muted-foreground">
                    Uptime: {formatUptime(systemStatus.uptime_seconds)}
                  </span>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-gray-400" />
            <span className="text-muted-foreground">No data</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Version Info */}
        <span className="text-muted-foreground">v1.0.0</span>

        {/* Footer Toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dispatch(toggleFooter())}
          className="h-6 w-6 p-0"
        >
          <EyeOff className="h-3 w-3" />
        </Button>
      </div>
    </footer>
  );
}
