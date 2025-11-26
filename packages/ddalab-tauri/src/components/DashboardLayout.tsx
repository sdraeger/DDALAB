"use client";

import { useState, useEffect } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { ApiService } from "@/services/apiService";
import { useAppStore } from "@/store/appStore";
import { useDDAHistory, useAnalysisFromHistory } from "@/hooks/useDDAAnalysis";
import { DDAProgressEvent } from "@/types/api";
import { FileManager } from "@/components/FileManager";
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

interface DashboardLayoutProps {
  apiUrl: string;
  sessionToken?: string;
}

export function DashboardLayout({
  apiUrl,
  sessionToken,
}: DashboardLayoutProps) {
  const [apiService, setApiService] = useState(() => {
    return new ApiService(apiUrl, sessionToken);
  });
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  // FIX: Use specific selectors to prevent unnecessary re-renders
  // Only select the specific properties we need, not entire objects
  const isServerReady = useAppStore((state) => state.ui.isServerReady);
  const sidebarOpen = useAppStore((state) => state.ui.sidebarOpen);
  const sidebarWidth = useAppStore((state) => state.ui.sidebarWidth);
  const activeTab = useAppStore((state) => state.ui.activeTab);
  const primaryNav = useAppStore((state) => state.ui.primaryNav);
  const secondaryNav = useAppStore((state) => state.ui.secondaryNav);
  const currentFilePath = useAppStore(
    (state) => state.fileManager.selectedFile?.file_path,
  );
  const selectedFileName = useAppStore(
    (state) => state.fileManager.selectedFile?.file_name,
  );
  const hasCurrentAnalysis = useAppStore(
    (state) => !!state.dda.currentAnalysis,
  );
  const currentAnalysisId = useAppStore(
    (state) => state.dda.currentAnalysis?.id,
  );
  const isPersistenceRestored = useAppStore(
    (state) => state.isPersistenceRestored,
  );
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const setSidebarWidth = useAppStore((state) => state.setSidebarWidth);
  const setPrimaryNav = useAppStore((state) => state.setPrimaryNav);
  const setSecondaryNav = useAppStore((state) => state.setSecondaryNav);
  const setLayout = useAppStore((state) => state.setLayout);
  const setCurrentAnalysis = useAppStore((state) => state.setCurrentAnalysis);
  const setAnalysisHistory = useAppStore((state) => state.setAnalysisHistory);
  const setDDARunning = useAppStore((state) => state.setDDARunning);

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

  // Update API service when URL or session token changes
  useEffect(() => {
    // Use the apiUrl prop which already has the correct protocol from page.tsx
    const newApiUrl = apiUrl;
    const currentToken = apiService.getSessionToken();

    // If only token changed, update the existing instance to avoid recreating
    if (
      apiService.baseURL === newApiUrl &&
      sessionToken &&
      currentToken !== sessionToken
    ) {
      apiService.setSessionToken(sessionToken);
      setIsAuthReady(true);
      window.dispatchEvent(new CustomEvent("api-service-auth-ready"));
    }
    // If URL changed, we need a new instance
    else if (apiService.baseURL !== newApiUrl) {
      const newService = new ApiService(newApiUrl, sessionToken);
      setApiService(newService);
      setIsAuthReady(!!sessionToken);

      // Dispatch event to signal that auth is ready
      if (sessionToken) {
        window.dispatchEvent(new CustomEvent("api-service-auth-ready"));
      }
    }
    // Mark as ready if token already matches
    else if (sessionToken && currentToken === sessionToken) {
      setIsAuthReady(true);
      window.dispatchEvent(new CustomEvent("api-service-auth-ready"));
    }
  }, [apiUrl, sessionToken, apiService.baseURL]);

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

  // Poll for unread notification count
  useEffect(() => {
    if (!TauriService.isTauri()) return;

    const fetchUnreadCount = async () => {
      try {
        const count = await TauriService.getUnreadCount();
        setUnreadNotificationCount(count);
      } catch (error) {
        console.error(
          "[DASHBOARD] Failed to fetch unread notification count:",
          error,
        );
      }
    };

    // Initial fetch
    fetchUnreadCount();

    // Poll every 5 seconds
    const interval = setInterval(fetchUnreadCount, 5000);

    return () => clearInterval(interval);
  }, []);

  // Refresh unread count when viewing notifications tab
  useEffect(() => {
    if (!TauriService.isTauri()) return;

    if (activeTab === "notifications") {
      // Refresh after a short delay to allow notifications to be marked as read
      const timeout = setTimeout(async () => {
        try {
          const count = await TauriService.getUnreadCount();
          setUnreadNotificationCount(count);
        } catch (error) {
          console.error("[DASHBOARD] Failed to refresh unread count:", error);
        }
      }, 1000);

      return () => clearTimeout(timeout);
    }
  }, [activeTab]);

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
    <div className="h-screen flex flex-col bg-background">
      {/* Title Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background">
        <div className="flex items-center space-x-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="h-8 w-8"
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeftOpen className="h-4 w-4" />
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
            <div className="flex items-center space-x-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleMinimize}
                className="h-6 w-6"
              >
                <Minimize2 className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleMaximize}
                className="h-6 w-6"
              >
                <Maximize2 className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                className="h-6 w-6 text-red-500 hover:text-red-600"
              >
                ×
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen ? (
          <>
            <div
              className="flex-shrink-0 border-r bg-background overflow-hidden flex flex-col"
              style={{ width: `${sidebarWidth}px` }}
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
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Primary Navigation */}
          <PrimaryNavigation />

          {/* Secondary Navigation (contextual) */}
          <SecondaryNavigation />

          {/* Main Content */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <NavigationContent apiService={apiService} />
          </div>
        </div>
      </div>

      {/* Health Status Bar */}
      <HealthStatusBar apiService={apiService} />
    </div>
  );
}
