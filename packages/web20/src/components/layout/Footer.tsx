"use client";

import React, { useState } from "react";
import { useAppDispatch, useFooterVisible } from "@/store/hooks";
import { toggleFooter } from "@/store/slices/userSlice";
import { Activity, Wifi, Database, EyeOff, AlertTriangle, Clock } from "lucide-react";
import { 
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import {
  useSystemStatus,
  formatUptime,
  getStatusColor,
} from "@/hooks/useSystemStatus";

// Available update speeds (in milliseconds)
const UPDATE_SPEEDS = [
  { value: 1000, label: '1s', display: 'Fast' },
  { value: 2000, label: '2s', display: 'Default' },
  { value: 5000, label: '5s', display: 'Slow' },
  { value: 10000, label: '10s', display: 'Very Slow' },
  { value: 30000, label: '30s', display: 'Ultra Slow' },
] as const;

export function Footer() {
  const dispatch = useAppDispatch();
  const footerVisible = useFooterVisible();
  const [updateInterval, setUpdateInterval] = useState(2000); // Default to 2 seconds
  
  const { systemStatus, isLoading, error } = useSystemStatus({
    refreshInterval: updateInterval,
    enabled: footerVisible, // Only fetch when footer is visible
  });

  const handleUpdateSpeedChange = (value: string) => {
    const newInterval = parseInt(value);
    setUpdateInterval(newInterval);
  };

  const getCurrentSpeedLabel = () => {
    const speed = UPDATE_SPEEDS.find(s => s.value === updateInterval);
    return speed ? speed.label : `${updateInterval}ms`;
  };

  if (!footerVisible) return null;

  return (
    <footer className="flex h-12 items-center justify-between border-t bg-background px-4 text-sm">
      <div className="flex items-center gap-4 flex-1">
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

            {/* Update Speed Selector */}
            <div className="flex items-center gap-1 ml-2" title={`Update every ${getCurrentSpeedLabel()}`}>
              <Clock className={`h-3 w-3 ${isLoading ? 'animate-spin text-blue-500' : 'text-muted-foreground'}`} />
              <Select value={updateInterval.toString()} onValueChange={handleUpdateSpeedChange}>
                <SelectTrigger className="h-6 w-auto min-w-12 px-2 py-0 text-xs border-0 bg-transparent hover:bg-accent focus:ring-0 focus:ring-offset-0">
                  <SelectValue placeholder={getCurrentSpeedLabel()} />
                </SelectTrigger>
                <SelectContent>
                  {UPDATE_SPEEDS.map((speed) => (
                    <SelectItem key={speed.value} value={speed.value.toString()}>
                      <div className="flex items-center justify-between w-full">
                        <span>{speed.label}</span>
                        <span className="text-muted-foreground text-xs ml-2">{speed.display}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-gray-400" />
            <span className="text-muted-foreground">No data</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
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
