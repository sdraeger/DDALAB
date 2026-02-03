"use client";

import { useEffect, useCallback } from "react";
import { ActiveFileProvider } from "@/contexts/ActiveFileContext";
import { useAppStore } from "@/store/appStore";
import {
  useUISelectors,
  useDDASelectors,
  usePersistenceSelectors,
} from "@/hooks/useStoreSelectors";
import { useDDAHistory, useAnalysisFromHistory } from "@/hooks/useDDAAnalysis";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { useAnalysisEventListener } from "@/hooks/useAnalysisCoordinator";
import { FileManager } from "@/components/FileManager";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FileTabBar } from "@/components/FileTabBar";
import { FileTabShortcuts } from "@/components/FileTabShortcuts";
import { FileTabSync } from "@/components/FileTabSync";
import { FileNavigationSync } from "@/components/FileNavigationSync";
import { ResizeHandle } from "@/components/ResizeHandle";
import { HealthStatusBar } from "@/components/HealthStatusBar";
import { MainContentContainer } from "@/components/MainContentContainer";
import { PrimaryNavigation } from "@/components/navigation/PrimaryNavigation";
import { SecondaryNavigation } from "@/components/navigation/SecondaryNavigation";
import { NavigationContent } from "@/components/navigation/NavigationContent";
import { Button } from "@/components/ui/button";
import { TabDropZone } from "@/components/TabDropZone";
import {
  Brain,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { TauriService } from "@/services/tauriService";
import { WorkflowRecorder } from "@/components/workflow/WorkflowRecorder";
import { createLogger } from "@/lib/logger";
import { useOpenFilesStore } from "@/store/openFilesStore";

const logger = createLogger("Dashboard");

export function DashboardLayout() {
  // Initialize the global analysis event listener (single source of truth)
  useAnalysisEventListener();

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
  // Only enable when server is ready to avoid connection errors
  const {
    data: historyData,
    isLoading: isLoadingHistory,
    error: historyError,
  } = useDDAHistory(isServerReady);

  // Sync history data to Zustand store when it changes
  useEffect(() => {
    if (historyData) {
      logger.debug("Loaded analysis history", { count: historyData.length });
      setAnalysisHistory(historyData);
    } else if (historyError) {
      logger.error("Failed to load analysis history", { error: historyError });
      setAnalysisHistory([]);
    }
  }, [historyData, historyError, setAnalysisHistory]);

  // DISABLED: Auto-loading full analysis data at dashboard level was causing UI freezes
  // due to large JSON parsing (~700k+ numbers in dda_matrix). Full data loading is now
  // handled lazily by DDAWithHistory when user explicitly requests results (clicks
  // history item or switches to results tab).
  // See: DDAWithHistory.tsx useAnalysisFromHistory with userRequestedResults guard
  const { data: autoLoadedAnalysis, isLoading: isAutoLoading } =
    useAnalysisFromHistory(null, false);

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

  // NOTE: DDA completion events are now handled by useAnalysisEventListener
  // which is initialized at the top of this component

  // Handle notification navigation
  const handleNotificationNavigate = (
    actionType: string,
    actionData: unknown,
  ) => {
    logger.debug("Notification clicked", { actionType, actionData });

    switch (actionType) {
      case "navigate_nsg_manager":
        setPrimaryNav("data");
        setSecondaryNav("nsg-jobs");
        break;
      case "navigate_results":
      case "navigate_analysis":
        setPrimaryNav("analyze");
        break;
      case "view-analysis":
        // Navigate to analysis view
        setPrimaryNav("analyze");
        // If we have the analysis ID, we could potentially load it
        logger.debug("Navigating to analysis", {
          analysisId: (actionData as { analysisId?: string })?.analysisId,
        });
        break;
      case "navigate_openneuro":
        setPrimaryNav("data");
        setSecondaryNav("openneuro");
        break;
      case "navigate_settings":
        setPrimaryNav("settings");
        break;
      default:
        logger.warn("Unknown notification action type", { actionType });
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

  // Handle tabs transferred from other windows via cross-window drag
  const { openFile } = useOpenFilesStore();
  const handleTabReceived = useCallback(
    (tabData: { filePath: string; fileName: string }) => {
      logger.info("Tab received from another window", {
        filePath: tabData.filePath,
      });
      openFile(tabData.filePath);
    },
    [openFile],
  );

  return (
    <TabDropZone onTabReceived={handleTabReceived}>
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

          <div className="flex items-center space-x-4">
            <WorkflowRecorder />

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
                  className="h-6 w-6 text-red-500 hover:text-red-600 transition-colors duration-200"
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
          {/* Sidebar - smooth width transition */}
          <div
            className="flex-shrink-0 border-r bg-background overflow-hidden flex flex-col transition-[width] duration-slow ease-smooth-out"
            style={{ width: sidebarOpen ? `${sidebarWidth}px` : "48px" }}
            data-testid="sidebar"
          >
            {sidebarOpen ? (
              <div className="animate-fade-in h-full">
                <ErrorBoundary>
                  <FileManager />
                </ErrorBoundary>
              </div>
            ) : (
              <div
                className="w-full h-full hover:bg-accent transition-colors duration-fast cursor-pointer flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-ring animate-fade-in"
                onClick={() => setSidebarOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSidebarOpen(true);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label="Expand sidebar"
                aria-expanded="false"
                title="Click or press Enter/Space to expand sidebar"
              >
                <PanelLeftOpen className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
          </div>
          {sidebarOpen && (
            <ResizeHandle
              onResize={setSidebarWidth}
              initialWidth={sidebarWidth}
              minWidth={200}
              maxWidth={600}
            />
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
              <MainContentContainer data-testid="main-content">
                <NavigationContent />
              </MainContentContainer>
            </div>
          </ActiveFileProvider>
        </div>

        {/* Health Status Bar */}
        <HealthStatusBar />
      </div>
    </TabDropZone>
  );
}
