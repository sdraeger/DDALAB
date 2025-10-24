"use client";

import { useState, useEffect } from "react";
import { ApiService } from "@/services/apiService";
import { useAppStore } from "@/store/appStore";
import { useDDAHistory, useAnalysisFromHistory } from "@/hooks/useDDAAnalysis";
import { FileManager } from "@/components/FileManager";
import { HealthStatusBar } from "@/components/HealthStatusBar";
import { DDAProgressIndicator } from "@/components/DDAProgressIndicator";
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

export function DashboardLayout({ apiUrl, sessionToken }: DashboardLayoutProps) {
  console.log('[DASHBOARD] DashboardLayout rendered with apiUrl:', apiUrl, 'hasToken:', !!sessionToken);

  const [apiService, setApiService] = useState(() => {
    console.log('[DASHBOARD] Creating initial ApiService with URL:', apiUrl);
    return new ApiService(apiUrl, sessionToken);
  });
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  // Use selectors to prevent unnecessary re-renders
  const ui = useAppStore((state) => state.ui);
  const fileManager = useAppStore((state) => state.fileManager);
  const currentAnalysis = useAppStore((state) => state.dda.currentAnalysis);
  const analysisHistory = useAppStore((state) => state.dda.analysisHistory);
  const isPersistenceRestored = useAppStore((state) => state.isPersistenceRestored);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const setPrimaryNav = useAppStore((state) => state.setPrimaryNav);
  const setSecondaryNav = useAppStore((state) => state.setSecondaryNav);
  const setLayout = useAppStore((state) => state.setLayout);
  const setCurrentAnalysis = useAppStore((state) => state.setCurrentAnalysis);
  const setAnalysisHistory = useAppStore((state) => state.setAnalysisHistory);

  // Use Tanstack Query hook for async, non-blocking history loading
  // Only enable when server is ready and authenticated to avoid connection errors
  const {
    data: historyData,
    isLoading: isLoadingHistory,
    error: historyError
  } = useDDAHistory(apiService, ui.isServerReady && isAuthReady);

  // Sync history data to Zustand store when it changes
  useEffect(() => {
    if (historyData) {
      console.log("[DASHBOARD] Loaded analysis history:", historyData.length, "items");
      setAnalysisHistory(historyData);
    } else if (historyError) {
      console.error("[DASHBOARD] Failed to load analysis history:", historyError);
      setAnalysisHistory([]);
    }
  }, [historyData, historyError, setAnalysisHistory]);

  // Determine which analysis to auto-load (if any)
  // Only enable auto-load if: no current analysis, persistence restored, and history loaded
  // IMPORTANT: Filter history by current file to prevent loading results from different files
  const currentFilePath = fileManager.selectedFile?.file_path;
  const fileSpecificHistory = historyData?.filter(item => item.file_path === currentFilePath) || [];
  const shouldAutoLoad = !currentAnalysis && isPersistenceRestored && fileSpecificHistory.length > 0 && !isLoadingHistory && !!currentFilePath;
  const analysisIdToLoad = shouldAutoLoad ? fileSpecificHistory[0].id : null;

  // Use Tanstack Query to load the most recent analysis (async, non-blocking)
  const {
    data: autoLoadedAnalysis,
    isLoading: isAutoLoading
  } = useAnalysisFromHistory(apiService, analysisIdToLoad, !!analysisIdToLoad);

  // Set the auto-loaded analysis once it's fetched
  // IMPORTANT: Verify the analysis belongs to the current file before setting it
  useEffect(() => {
    if (autoLoadedAnalysis && !currentAnalysis && currentFilePath) {
      // Double-check the file path matches to prevent race conditions
      if (autoLoadedAnalysis.file_path === currentFilePath) {
        console.log("[DASHBOARD] Setting auto-loaded analysis:", autoLoadedAnalysis.id, "for file:", currentFilePath);
        setCurrentAnalysis(autoLoadedAnalysis);
      } else {
        console.warn("[DASHBOARD] Skipping auto-load - analysis file path mismatch:", {
          analysisFile: autoLoadedAnalysis.file_path,
          currentFile: currentFilePath
        });
      }
    }
  }, [autoLoadedAnalysis, currentAnalysis, currentFilePath, setCurrentAnalysis]);

  // Update API service when URL or session token changes
  useEffect(() => {
    // Use the apiUrl prop which already has the correct protocol from page.tsx
    const newApiUrl = apiUrl;
    const currentToken = apiService.getSessionToken();

    console.log('[DASHBOARD] API service check:', {
      currentURL: apiService.baseURL,
      newURL: newApiUrl,
      currentToken: currentToken?.substring(0, 8) + '...' || 'NONE',
      newToken: sessionToken?.substring(0, 8) + '...' || 'NONE',
      needsUpdate: apiService.baseURL !== newApiUrl || (sessionToken && currentToken !== sessionToken)
    });

    // If only token changed, update the existing instance to avoid recreating
    if (apiService.baseURL === newApiUrl && sessionToken && currentToken !== sessionToken) {
      console.log('[DASHBOARD] Updating token on existing API service:', sessionToken?.substring(0, 8) + '...');
      apiService.setSessionToken(sessionToken);
      setIsAuthReady(true);

      // Dispatch event to signal that auth is ready - this allows page.tsx to wait
      console.log('[DASHBOARD] Dispatching api-service-auth-ready event');
      window.dispatchEvent(new CustomEvent('api-service-auth-ready'));
    }
    // If URL changed, we need a new instance
    else if (apiService.baseURL !== newApiUrl) {
      console.log('[DASHBOARD] Creating new API service with URL:', newApiUrl, 'and token:', sessionToken?.substring(0, 8) + '...');
      const newService = new ApiService(newApiUrl, sessionToken);
      setApiService(newService);
      setIsAuthReady(!!sessionToken);

      // Dispatch event to signal that auth is ready
      if (sessionToken) {
        console.log('[DASHBOARD] Dispatching api-service-auth-ready event');
        window.dispatchEvent(new CustomEvent('api-service-auth-ready'));
      }
    }
    // Mark as ready if token already matches
    else if (sessionToken && currentToken === sessionToken) {
      setIsAuthReady(true);
      // Dispatch event to signal that auth is ready
      console.log('[DASHBOARD] Dispatching api-service-auth-ready event (token already set)');
      window.dispatchEvent(new CustomEvent('api-service-auth-ready'));
    }
  }, [apiUrl, sessionToken, apiService.baseURL]);

  // Listen for navigation events from NSG Job Manager
  useEffect(() => {
    const handleNavigateToMainResults = () => {
      console.log('[DASHBOARD] Navigating to Analyze > DDA for NSG results');
      setPrimaryNav('analyze');
      setSecondaryNav('dda');
    };

    window.addEventListener('navigate-to-main-results', handleNavigateToMainResults);

    return () => {
      window.removeEventListener('navigate-to-main-results', handleNavigateToMainResults);
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
        console.error('[DASHBOARD] Failed to fetch unread notification count:', error);
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

    if (ui.activeTab === 'notifications') {
      // Refresh after a short delay to allow notifications to be marked as read
      const timeout = setTimeout(async () => {
        try {
          const count = await TauriService.getUnreadCount();
          setUnreadNotificationCount(count);
        } catch (error) {
          console.error('[DASHBOARD] Failed to refresh unread count:', error);
        }
      }, 1000);

      return () => clearTimeout(timeout);
    }
  }, [ui.activeTab]);

  // Handle notification navigation
  const handleNotificationNavigate = (actionType: string, actionData: any) => {
    console.log('[DASHBOARD] Notification clicked:', actionType, actionData);

    switch (actionType) {
      case 'navigate_nsg_manager':
        setPrimaryNav('manage');
        setSecondaryNav('jobs');
        break;
      case 'navigate_results':
      case 'navigate_analysis':
        setPrimaryNav('analyze');
        setSecondaryNav('dda');
        break;
      case 'navigate_openneuro':
        setPrimaryNav('manage');
        setSecondaryNav('data-sources');
        break;
      case 'navigate_settings':
        setPrimaryNav('manage');
        setSecondaryNav('settings');
        break;
      default:
        console.warn('[DASHBOARD] Unknown notification action type:', actionType);
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
            onClick={() => setSidebarOpen(!ui.sidebarOpen)}
            className="h-8 w-8"
          >
            {ui.sidebarOpen ? (
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
            {fileManager.selectedFile?.file_name || "No file selected"}
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
        {ui.sidebarOpen ? (
          <div className="w-80 flex-shrink-0 border-r bg-background overflow-hidden flex flex-col">
            <FileManager apiService={apiService} />
          </div>
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

      {/* Global DDA Progress Indicator - visible on all tabs */}
      <DDAProgressIndicator />
    </div>
  );
}
