"use client";

import React, { useEffect, useState } from "react";
import { BackendProvider } from "@/contexts/BackendContext";
import { StatePersistenceProvider } from "@/components/StatePersistenceProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PopoutDashboard } from "./PopoutDashboard";
import { Loader2, Brain } from "lucide-react";

// Import panels to trigger registration
import "@/panels";

/**
 * File Viewer Popout Window
 *
 * A full DDALAB instance in a popout window. Provides the complete
 * DDALAB experience with all navigation, analysis, and visualization features.
 */
export default function FileViewerPopout() {
  const [isClient, setIsClient] = useState(false);
  const [windowId, setWindowId] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Parse URL params
  useEffect(() => {
    if (!isClient) return;

    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get("id");
    const file = urlParams.get("file");

    if (id) setWindowId(id);
    if (file) setFilePath(decodeURIComponent(file));
  }, [isClient]);

  // Show loading while initializing
  if (!isClient) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background">
        <Brain className="h-12 w-12 text-primary mb-4 animate-pulse" />
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">Initializing DDALAB...</p>
      </div>
    );
  }

  // Ensure we have required data
  if (!windowId) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background text-muted-foreground">
        <Brain className="h-12 w-12 mb-4 opacity-50" />
        <h3 className="text-lg font-medium mb-2">Missing Configuration</h3>
        <p className="text-sm">Window ID not available</p>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <BackendProvider>
        <StatePersistenceProvider>
          <PopoutDashboard
            windowId={windowId}
            initialFilePath={filePath || undefined}
          />
        </StatePersistenceProvider>
      </BackendProvider>
    </ErrorBoundary>
  );
}
