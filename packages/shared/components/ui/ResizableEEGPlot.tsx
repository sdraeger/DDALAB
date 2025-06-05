"use client";

import React from "react";
import { ResizableContainer } from "./ResizableContainer";

interface ResizableEEGPlotProps {
  children: React.ReactNode;
  filePath: string;
  className?: string;
  variant?: "default" | "dialog" | "persistent" | "results";
  enabled?: boolean;
  onHeightChange?: (height: number) => void;
}

const VARIANT_CONFIGS = {
  default: {
    defaultHeight: 400,
    minHeight: 200,
    maxHeight: 800,
    storagePrefix: "eeg-plot-height",
  },
  dialog: {
    defaultHeight: 600,
    minHeight: 300,
    maxHeight: 1200,
    storagePrefix: "edf-dialog-plot-height",
  },
  persistent: {
    defaultHeight: 500,
    minHeight: 250,
    maxHeight: 1000,
    storagePrefix: "persistent-eeg-plot-height",
  },
  results: {
    defaultHeight: 400,
    minHeight: 200,
    maxHeight: 800,
    storagePrefix: "results-eeg-plot-height",
  },
};

/**
 * A convenience wrapper around ResizableContainer specifically designed for EEG plots.
 * Provides sensible defaults and file-specific storage keys.
 *
 * @param filePath - The EDF file path, used to create unique storage keys
 * @param variant - Predefined configuration sets for different use cases
 * @param enabled - Whether resizing is enabled (defaults to true)
 */
export function ResizableEEGPlot({
  children,
  filePath,
  className,
  variant = "default",
  enabled = true,
  onHeightChange,
}: ResizableEEGPlotProps) {
  const config = VARIANT_CONFIGS[variant];

  // Create a safe storage key from the file path
  const sanitizedFilePath = filePath
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const storageKey = `${config.storagePrefix}-${sanitizedFilePath}`;

  return (
    <ResizableContainer
      className={className}
      storageKey={storageKey}
      defaultHeight={config.defaultHeight}
      minHeight={config.minHeight}
      maxHeight={config.maxHeight}
      enabled={enabled}
      onHeightChange={onHeightChange}
    >
      {children}
    </ResizableContainer>
  );
}
