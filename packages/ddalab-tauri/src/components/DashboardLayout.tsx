"use client";

import { useEffect } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useApiService } from "@/contexts/ApiServiceContext";
import { ActiveFileProvider } from "@/contexts/ActiveFileContext";
import { useAppStore } from "@/store/appStore";
import {
  useUISelectors,
  useDDASelectors,
  usePersistenceSelectors,
} from "@/hooks/useStoreSelectors";
import { useDDAHistory, useAnalysisFromHistory } from "@/hooks/useDDAAnalysis";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { DDAProgressEvent } from "@/types/api";
import { FileManager } from "@/components/FileManager";
import { FileTabBar } from "@/components/FileTabBar";
import { FileTabShortcuts } from "@/components/FileTabShortcuts";
import { FileTabSync } from "@/components/FileTabSync";
import { FileNavigationSync } from "@/components/FileNavigationSync";
import { ResizeHandle } from "@/components/ResizeHandle";
import { HealthStatusBar } from "@/components/HealthStatusBar";
import { PrimaryNavigation } from "@/components/navigation/PrimaryNavigation";
import { SecondaryNavigation } from "@/components/navigation/SecondaryNavigation";
import { NavigationContent } from "@/components/navigation/NavigationContent";
import { Button } from "@/components/ui/button";
import {
  Brain,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { TauriService } from "@/services/tauriService";

export function DashboardLayout() {
  // Get ApiService from context (managed by ApiServiceProvider in page.tsx)
  const { apiService, isReady: isAuthReady } = useApiService();

  // Event-based notification count (no polling)
  const unreadNotificationCount = useUnreadNotificationCount();

  // Consolidated selector hooks for cleaner state access
  const {
    isServerReady,
    sidebarOpen,
    sidebarWidth,
    primaryNav,
    secondaryNav,
    setSidebarOpen,
    setSidebarWidth,
    setPrimaryNav,
    setSecondaryNav,
    setLayout,
  } = useUISelectors();

  const {
    currentAnalysis,
    setCurrentAnalysis,
    setAnalysisHistory,
    setDDARunning,
  } = useDDASelectors();

  const { isPersistenceRestored } = usePersistenceSelectors();

  // Derived values from selectors (computed inline for render optimization)
  const currentFilePath = useAppStore(
    (state) => state.fileManager.selectedFile?.file_path,
  );
  const selectedFileName = useAppStore(
    (state) => state.fileManager.selectedFile?.file_name,
  );
  const hasCurrentAnalysis = !!currentAnalysis;
  const currentAnalysisId = currentAnalysis?.id;

  // Use Tanstack Query hook for async, non-blocking history loading
  // Only enable when server is ready and authenticated to avoid connection errors
  const {
    data: historyData,
    isLoading: isLoadingHistory,
    error: historyError,
  } = useDDAHistory(apiService, isServerReady && isAuthReady);

  // Sync history data to Zustand store when it changes
  useEffect(() => {
    if (historyData) {
      console.log(
        "[DASHBOARD] Loaded analysis history:",
        historyData.length,
        "items",
      );
      setAnalysisHistory(historyData);
    } else if (historyError) {
      console.error(
        "[DASHBOARD] Failed to load analysis history:",
        historyError,
      );
      setAnalysisHistory([]);
    }
  }, [historyData, historyError, setAnalysisHistory]);

  // Determine which analysis to auto-load (if any)
  // Only enable auto-load if: no current analysis, persistence restored, and history loaded
  // IMPORTANT: Filter history by current file to prevent loading results from different files
  // Normalize paths for comparison (handle trailing slashes, backslashes, etc.)
  const normalizePath = (path: string | undefined | null): string => {
    if (!path) return "";
    return path.replace(/\\/g, "/").replace(/\/+$/, "");
  };
  const normalizedCurrentFilePath = normalizePath(currentFilePath);
  const fileSpecificHistory =
    historyData?.filter(
      (item) => normalizePath(item.file_path) === normalizedCurrentFilePath,
    ) || [];
  const shouldAutoLoad =
    !hasCurrentAnalysis &&
    isPersistenceRestored &&
    fileSpecificHistory.length > 0 &&
    !isLoadingHistory &&
    !!currentFilePath;
  const analysisIdToLoad = shouldAutoLoad ? fileSpecificHistory[0].id : null;

  // Use Tanstack Query to load the most recent analysis (async, non-blocking)
  const { data: autoLoadedAnalysis, isLoading: isAutoLoading } =
    useAnalysisFromHistory(apiService, analysisIdToLoad, !!analysisIdToLoad);

  // Set the auto-loaded analysis once it's fetched
  // DISABLED: Auto-loading is now handled by DDAWithHistory component
  // This prevents duplicate setCurrentAnalysis calls when DDAWithHistory loads from manual selection
  // DDAWithHistory will auto-select the most recent analysis, so we don't need to do it here
  // The autoLoadedAnalysis state is still used by DDAWithHistory to know which analysis to display

  // Listen for navigation events from NSG Job Manager
  useEffect(() => {
    const handleNavigateToMainResults = () => {
      setPrimaryNav("analyze");
    };

    window.addEventListener(
      "navigate-to-main-results",
      handleNavigateToMainResults,
    );

    return () => {
      window.removeEventListener(
        "navigate-to-main-results",
        handleNavigateToMainResults,
      );
    };
  }, [setPrimaryNav, setSecondaryNav]);

  // Listen for DDA completion events to unlock the configure tab
  useEffect(() => {
    if (!TauriService.isTauri()) return;

    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<DDAProgressEvent>("dda-progress", (event) => {
        const phase = event.payload.phase;

        // When DDA completes (successfully or with error), unlock the configure tab
        if (phase === "completed" || phase === "error") {
          console.log(
            "[DASHBOARD] DDA analysis finished, unlocking configure tab",
          );
          setDDARunning(false);
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [setDDARunning]);

  // Handle notification navigation
  const handleNotificationNavigate = (actionType: string, actionData: any) => {
    console.log("[DASHBOARD] Notification clicked:", actionType, actionData);

    switch (actionType) {
      case "navigate_nsg_manager":
        setPrimaryNav("manage");
        setSecondaryNav("jobs");
        break;
      case "navigate_results":
      case "navigate_analysis":
        setPrimaryNav("analyze");
        break;
      case "view-analysis":
        // Navigate to analysis view
        setPrimaryNav("analyze");
        // If we have the analysis ID, we could potentially load it
        // For now, just navigate to the analysis tab where the user can see it in history
        console.log(
          "[DASHBOARD] Navigating to analysis:",
          actionData?.analysisId,
        );
        break;
      case "navigate_openneuro":
        setPrimaryNav("manage");
        setSecondaryNav("data-sources");
        break;
      case "navigate_settings":
        setPrimaryNav("manage");
        setSecondaryNav("settings");
        break;
      default:
        console.warn(
          "[DASHBOARD] Unknown notification action type:",
          actionType,
        );
    }
  };

  const handleMinimize = async () => {
    if (TauriService.isTauri()) {
      await TauriService.minimizeWindow();
    }
  };

  const handleMaximize = async () => {
    if (TauriService.isTauri()) {
      await TauriService.maximizeWindow();
    }
  };

  const handleClose = async () => {
    if (TauriService.isTauri()) {
      await TauriService.closeWindow();
    }
  };

  return (
    <div
      className="h-screen flex flex-col bg-background"
      data-testid="dashboard-layout"
    >
      {/* Title Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background">
        <div className="flex items-center space-x-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="h-8 w-8"
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            aria-expanded={sidebarOpen}
            data-testid="sidebar-toggle"
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>

          <div className="flex items-center space-x-2">
            <Brain className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-lg font-bold">DDALAB Desktop</h1>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <div className="text-sm text-muted-foreground">
            {selectedFileName || "No file selected"}
          </div>

          {TauriService.isTauri() && (
            <div
              className="flex items-center space-x-1"
              role="group"
              aria-label="Window controls"
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={handleMinimize}
                className="h-6 w-6"
                aria-label="Minimize window"
              >
                <Minimize2 className="h-3 w-3" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleMaximize}
                className="h-6 w-6"
                aria-label="Maximize window"
              >
                <Maximize2 className="h-3 w-3" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                className="h-6 w-6 text-red-500 hover:text-red-600 transition-colors"
                aria-label="Close window"
              >
                <span aria-hidden="true">×</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* File Tabs */}
      <FileTabShortcuts />
      <FileTabSync />
      <FileTabBar />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen ? (
          <>
            <div
              className="flex-shrink-0 border-r bg-background overflow-hidden flex flex-col"
              style={{ width: `${sidebarWidth}px` }}
              data-testid="sidebar"
            >
              <FileManager apiService={apiService} />
            </div>
            <ResizeHandle
              onResize={setSidebarWidth}
              initialWidth={sidebarWidth}
              minWidth={200}
              maxWidth={600}
            />
          </>
        ) : (
          <div
            className="w-12 flex-shrink-0 border-r bg-background hover:bg-accent transition-colors cursor-pointer flex items-center justify-center"
            onClick={() => setSidebarOpen(true)}
            title="Click to expand sidebar"
          >
            <PanelLeftOpen className="h-5 w-5 text-muted-foreground" />
          </div>
        )}

        {/* Content Area */}
        <ActiveFileProvider>
          {/* Sync navigation state with active file */}
          <FileNavigationSync />
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Primary Navigation */}
            <PrimaryNavigation />

            {/* Secondary Navigation (contextual) */}
            <SecondaryNavigation />

            {/* Main Content */}
            <div
              className="flex-1 overflow-y-auto overflow-x-hidden"
              data-testid="main-content"
            >
              <NavigationContent apiService={apiService} />
            </div>
          </div>
        </ActiveFileProvider>
      </div>

      {/* Health Status Bar */}
      <HealthStatusBar apiService={apiService} />
    </div>
  );
}
