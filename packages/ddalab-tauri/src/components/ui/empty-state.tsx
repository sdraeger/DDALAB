"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  FileX,
  FolderOpen,
  BarChart3,
  Radio,
  Settings,
  Bell,
  Search,
  Inbox,
  FileQuestion,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";

// Preset illustrations for common empty states
const presetIcons: Record<string, LucideIcon> = {
  files: FolderOpen,
  "no-files": FileX,
  analysis: BarChart3,
  streaming: Radio,
  settings: Settings,
  notifications: Bell,
  search: Search,
  inbox: Inbox,
  unknown: FileQuestion,
  error: AlertCircle,
};

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: "default" | "outline" | "secondary" | "ghost";
  icon?: LucideIcon;
}

export interface EmptyStateProps {
  // Icon can be a preset name or a custom icon
  icon?: keyof typeof presetIcons | LucideIcon;
  // Main title
  title: string;
  // Description text
  description?: string;
  // Optional helpful tips
  tips?: string[];
  // Primary action button
  action?: EmptyStateAction;
  // Secondary action
  secondaryAction?: EmptyStateAction;
  // Custom content below actions
  children?: React.ReactNode;
  // Size variant
  size?: "sm" | "md" | "lg";
  // Additional class names
  className?: string;
}

export function EmptyState({
  icon = "unknown",
  title,
  description,
  tips,
  action,
  secondaryAction,
  children,
  size = "md",
  className,
}: EmptyStateProps) {
  const Icon =
    typeof icon === "string" ? presetIcons[icon] || presetIcons.unknown : icon;

  const sizeClasses = {
    sm: {
      container: "py-6",
      icon: "h-10 w-10",
      iconContainer: "h-16 w-16",
      title: "text-sm",
      description: "text-xs",
    },
    md: {
      container: "py-10",
      icon: "h-12 w-12",
      iconContainer: "h-20 w-20",
      title: "text-base",
      description: "text-sm",
    },
    lg: {
      container: "py-16",
      icon: "h-16 w-16",
      iconContainer: "h-24 w-24",
      title: "text-lg",
      description: "text-base",
    },
  };

  const sizes = sizeClasses[size];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        sizes.container,
        className,
      )}
    >
      {/* Icon with subtle background */}
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-muted/50 mb-4",
          sizes.iconContainer,
        )}
      >
        <Icon
          className={cn("text-muted-foreground/60", sizes.icon)}
          strokeWidth={1.5}
        />
      </div>

      {/* Title */}
      <h3 className={cn("font-semibold text-foreground mb-1", sizes.title)}>
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p
          className={cn(
            "text-muted-foreground max-w-sm mx-auto",
            sizes.description,
          )}
        >
          {description}
        </p>
      )}

      {/* Tips */}
      {tips && tips.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
          {tips.map((tip, index) => (
            <li key={index} className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
              {tip}
            </li>
          ))}
        </ul>
      )}

      {/* Actions */}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-2 mt-6">
          {action && (
            <Button
              onClick={action.onClick}
              variant={action.variant || "default"}
              size={size === "sm" ? "sm" : "default"}
            >
              {action.icon && <action.icon className="h-4 w-4 mr-2" />}
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              onClick={secondaryAction.onClick}
              variant={secondaryAction.variant || "outline"}
              size={size === "sm" ? "sm" : "default"}
            >
              {secondaryAction.icon && (
                <secondaryAction.icon className="h-4 w-4 mr-2" />
              )}
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}

      {/* Custom content */}
      {children}
    </div>
  );
}

// Specialized empty state variants for common use cases
export function NoFilesEmptyState({
  onBrowse,
  onDrop,
}: {
  onBrowse?: () => void;
  onDrop?: () => void;
}) {
  return (
    <EmptyState
      icon="files"
      title="No files yet"
      description="Browse your data directory or drop files here to get started."
      action={
        onBrowse
          ? {
              label: "Browse Files",
              onClick: onBrowse,
              icon: FolderOpen,
            }
          : undefined
      }
      tips={[
        "Supported formats: EDF, CSV, BrainVision, XDF, and more",
        "Drag and drop files directly into this area",
      ]}
    />
  );
}

export function NoAnalysisEmptyState({ onStart }: { onStart?: () => void }) {
  return (
    <EmptyState
      icon="analysis"
      title="No analysis results"
      description="Select a file and run DDA analysis to see results here."
      action={
        onStart
          ? {
              label: "Start Analysis",
              onClick: onStart,
              icon: BarChart3,
            }
          : undefined
      }
      tips={[
        "First, select an EEG file from the Files panel",
        "Configure analysis parameters in Settings if needed",
        "Results will show variance, eigenvalues, and delay coordinates",
      ]}
    />
  );
}

export function NoSearchResultsEmptyState({
  query,
  onClear,
}: {
  query: string;
  onClear?: () => void;
}) {
  return (
    <EmptyState
      icon="search"
      title="No results found"
      description={`No matches for "${query}". Try different keywords or filters.`}
      action={
        onClear
          ? {
              label: "Clear Search",
              onClick: onClear,
              variant: "outline",
            }
          : undefined
      }
      tips={["Check for typos", "Try broader search terms", "Remove filters"]}
      size="sm"
    />
  );
}

export function NoNotificationsEmptyState() {
  return (
    <EmptyState
      icon="notifications"
      title="All caught up!"
      description="You have no notifications at the moment."
      size="sm"
      tips={[
        "Notifications appear when analysis completes",
        "File import results will show here",
        "Sync status updates appear here when connected",
      ]}
    />
  );
}

export function ErrorEmptyState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon="error"
      title="Something went wrong"
      description={message || "An unexpected error occurred. Please try again."}
      action={
        onRetry
          ? {
              label: "Try Again",
              onClick: onRetry,
              variant: "outline",
            }
          : undefined
      }
      tips={[
        "Check that the file format is supported",
        "Ensure the file is not corrupted or empty",
        "Try restarting the application if the issue persists",
      ]}
    />
  );
}
