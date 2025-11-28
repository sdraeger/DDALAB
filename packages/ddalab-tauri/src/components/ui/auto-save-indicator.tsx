"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Check, Cloud, CloudOff, Loader2, AlertCircle } from "lucide-react";
import { EnhancedTooltip } from "./enhanced-tooltip";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "offline";

export interface AutoSaveIndicatorProps {
  status: SaveStatus;
  lastSaved?: Date;
  errorMessage?: string;
  className?: string;
  showLabel?: boolean;
  size?: "sm" | "md";
}

function getRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return date.toLocaleDateString();
}

export function AutoSaveIndicator({
  status,
  lastSaved,
  errorMessage,
  className,
  showLabel = true,
  size = "md",
}: AutoSaveIndicatorProps) {
  const [displayTime, setDisplayTime] = React.useState<string>("");

  // Update relative time every 10 seconds
  React.useEffect(() => {
    if (!lastSaved) return;

    const updateTime = () => {
      setDisplayTime(getRelativeTime(lastSaved));
    };

    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, [lastSaved]);

  const sizeClasses = {
    sm: {
      container: "text-xs",
      icon: "h-3 w-3",
    },
    md: {
      container: "text-sm",
      icon: "h-4 w-4",
    },
  };

  const sizes = sizeClasses[size];

  const statusConfig: Record<
    SaveStatus,
    {
      icon: React.ElementType;
      label: string;
      color: string;
      animate?: boolean;
    }
  > = {
    idle: {
      icon: Cloud,
      label: "Auto-save enabled",
      color: "text-muted-foreground",
    },
    saving: {
      icon: Loader2,
      label: "Saving...",
      color: "text-primary",
      animate: true,
    },
    saved: {
      icon: Check,
      label: lastSaved ? `Saved ${displayTime}` : "Saved",
      color: "text-green-600",
    },
    error: {
      icon: AlertCircle,
      label: errorMessage || "Save failed",
      color: "text-destructive",
    },
    offline: {
      icon: CloudOff,
      label: "Offline - changes saved locally",
      color: "text-yellow-600",
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  const content = (
    <div
      className={cn(
        "flex items-center gap-1.5 transition-opacity",
        sizes.container,
        config.color,
        className,
      )}
    >
      <Icon className={cn(sizes.icon, config.animate && "animate-spin")} />
      {showLabel && (
        <span className="truncate max-w-[150px]">{config.label}</span>
      )}
    </div>
  );

  // Wrap in tooltip if not showing label
  if (!showLabel) {
    return (
      <EnhancedTooltip content={config.label} side="bottom">
        {content}
      </EnhancedTooltip>
    );
  }

  return content;
}

// Hook to manage auto-save state
export function useAutoSave({
  onSave,
  debounceMs = 1000,
  enabled = true,
}: {
  onSave: () => Promise<void>;
  debounceMs?: number;
  enabled?: boolean;
}) {
  const [status, setStatus] = React.useState<SaveStatus>("idle");
  const [lastSaved, setLastSaved] = React.useState<Date | undefined>();
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>();
  const debounceRef = React.useRef<NodeJS.Timeout | null>(null);
  const pendingRef = React.useRef(false);

  const save = React.useCallback(async () => {
    if (!enabled) return;

    setStatus("saving");
    setErrorMessage(undefined);

    try {
      await onSave();
      setStatus("saved");
      setLastSaved(new Date());
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Save failed");
    }
  }, [onSave, enabled]);

  const triggerSave = React.useCallback(() => {
    if (!enabled) return;

    // Mark as pending
    pendingRef.current = true;

    // Clear existing debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Set new debounce
    debounceRef.current = setTimeout(() => {
      if (pendingRef.current) {
        pendingRef.current = false;
        save();
      }
    }, debounceMs);
  }, [save, debounceMs, enabled]);

  // Force immediate save
  const saveNow = React.useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    pendingRef.current = false;
    await save();
  }, [save]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return {
    status,
    lastSaved,
    errorMessage,
    triggerSave,
    saveNow,
  };
}
