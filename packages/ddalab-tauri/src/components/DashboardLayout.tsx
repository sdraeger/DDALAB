"use client";

import { useState, useEffect } from "react";
import { ApiService } from "@/services/apiService";
import { useAppStore } from "@/store/appStore";
import { useDDAHistory, useAnalysisFromHistory } from "@/hooks/useDDAAnalysis";
import { FileManager } from "@/components/FileManager";
import { HealthStatusBar } from "@/components/HealthStatusBar";
import { TimeSeriesPlotECharts } from "@/components/TimeSeriesPlotECharts";
import { DDAAnalysis } from "@/components/DDAAnalysis";
import { DDAResults } from "@/components/DDAResults";
import { SettingsPanel } from "@/components/SettingsPanel";
import { OpenNeuroBrowser } from "@/components/OpenNeuroBrowser";
import { DDAProgressIndicator } from "@/components/DDAProgressIndicator";
import { NSGJobManager } from "@/components/NSGJobManager";
import { NotificationHistory } from "@/components/NotificationHistory";
import { AnnotationsTab } from "@/components/AnnotationsTab";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Brain,
  FileText,
  BarChart3,
  Activity,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2,
  Minimize2,
  Database,
  Cloud,
  Bell,
  MessageSquare,
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
  const setActiveTab = useAppStore((state) => state.setActiveTab);
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
  const shouldAutoLoad = !currentAnalysis && isPersistenceRestored && historyData && historyData.length > 0 && !isLoadingHistory;
  const analysisIdToLoad = shouldAutoLoad ? historyData[0].id : null;

  // Use Tanstack Query to load the most recent analysis (async, non-blocking)
  const {
    data: autoLoadedAnalysis,
    isLoading: isAutoLoading
  } = useAnalysisFromHistory(apiService, analysisIdToLoad, !!analysisIdToLoad);

  // Set the auto-loaded analysis once it's fetched
  useEffect(() => {
    if (autoLoadedAnalysis && !currentAnalysis) {
      console.log("[DASHBOARD] Setting auto-loaded analysis:", autoLoadedAnalysis.id);
      setCurrentAnalysis(autoLoadedAnalysis);
    }
  }, [autoLoadedAnalysis, currentAnalysis, setCurrentAnalysis]);

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
      console.log('[DASHBOARD] Navigating to main Results tab for NSG results');
      setActiveTab('results');
    };

    window.addEventListener('navigate-to-main-results', handleNavigateToMainResults);

    return () => {
      window.removeEventListener('navigate-to-main-results', handleNavigateToMainResults);
    };
  }, [setActiveTab]);

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
        setActiveTab('nsg');
        break;
      case 'navigate_results':
        setActiveTab('results');
        break;
      case 'navigate_analysis':
        setActiveTab('analyze');
        break;
      case 'navigate_openneuro':
        setActiveTab('openneuro');
        break;
      case 'navigate_settings':
        setActiveTab('settings');
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
          <Tabs
            value={ui.activeTab}
            onValueChange={setActiveTab}
            className="flex-1 flex flex-col overflow-hidden"
          >
            {/* Tab Navigation */}
            <div className="border-b px-4 py-2 flex-shrink-0">
              <TabsList>
                <TabsTrigger value="files" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Files
                </TabsTrigger>
                <TabsTrigger value="plots" className="flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Data Visualization
                </TabsTrigger>
                <TabsTrigger
                  value="analysis"
                  className="flex items-center gap-2"
                >
                  <BarChart3 className="h-4 w-4" />
                  DDA
                </TabsTrigger>
                <TabsTrigger
                  value="results"
                  className="flex items-center gap-2"
                >
                  <BarChart3 className="h-4 w-4" />
                  Results
                </TabsTrigger>
                <TabsTrigger
                  value="annotations"
                  className="flex items-center gap-2"
                >
                  <MessageSquare className="h-4 w-4" />
                  Annotations
                </TabsTrigger>
                <TabsTrigger
                  value="openneuro"
                  className="flex items-center gap-2"
                >
                  <Database className="h-4 w-4" />
                  OpenNeuro
                </TabsTrigger>
                {TauriService.isTauri() && (
                  <TabsTrigger
                    value="nsg"
                    className="flex items-center gap-2"
                  >
                    <Cloud className="h-4 w-4" />
                    NSG Jobs
                  </TabsTrigger>
                )}
                {TauriService.isTauri() && (
                  <TabsTrigger
                    value="notifications"
                    className="flex items-center gap-2"
                  >
                    <Bell className="h-4 w-4" />
                    Notifications
                    {unreadNotificationCount > 0 && (
                      <Badge variant="destructive" className="ml-1 px-1.5 py-0 text-xs min-w-[20px] h-5">
                        {unreadNotificationCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                )}
                <TabsTrigger
                  value="settings"
                  className="flex items-center gap-2"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Tab Content - Keep all tabs mounted to prevent remounting lag */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              <TabsContent value="files" className="m-0 h-full" forceMount hidden={ui.activeTab !== 'files'}>
                <div className="p-6">
                  {fileManager.selectedFile ? (
                    <div className="space-y-6">
                      <div>
                        <h2 className="text-2xl font-bold mb-4">
                          File Details
                        </h2>
                        <div className="bg-card border rounded-lg p-6">
                          <h3 className="text-lg font-semibold mb-4">
                            {fileManager.selectedFile.file_name}
                          </h3>
                          <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-3">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  Duration:
                                </span>
                                <span>
                                  {fileManager.selectedFile.duration?.toFixed(
                                    2
                                  ) || "0"}
                                  s
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  Sample Rate:
                                </span>
                                <span>
                                  {fileManager.selectedFile.sample_rate} Hz
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  Total Samples:
                                </span>
                                <span>
                                  {fileManager.selectedFile.total_samples?.toLocaleString() ||
                                    "0"}
                                </span>
                              </div>
                            </div>
                            <div className="space-y-3">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  Channels:
                                </span>
                                <span>
                                  {fileManager.selectedFile.channels.length}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  File Size:
                                </span>
                                <span>
                                  {(
                                    fileManager.selectedFile.file_size /
                                    1024 /
                                    1024
                                  ).toFixed(2)}{" "}
                                  MB
                                </span>
                              </div>
                            </div>
                          </div>

                          {fileManager.selectedFile.channels.length > 0 && (
                            <div className="mt-6">
                              <h4 className="font-medium mb-3">
                                Available Channels:
                              </h4>
                              <div className="flex flex-wrap gap-2">
                                {fileManager.selectedFile.channels
                                  .slice(0, 20)
                                  .map((channel, index) => (
                                    <span
                                      key={index}
                                      className="px-2 py-1 bg-secondary text-secondary-foreground rounded text-sm"
                                    >
                                      {channel}
                                    </span>
                                  ))}
                                {fileManager.selectedFile.channels.length >
                                  20 && (
                                  <span className="px-2 py-1 bg-muted text-muted-foreground rounded text-sm">
                                    +
                                    {fileManager.selectedFile.channels.length -
                                      20}{" "}
                                    more
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-medium mb-2">
                          No File Selected
                        </h3>
                        <p className="text-muted-foreground">
                          Select a file from the sidebar to view its details
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="plots" className="m-0 h-full" forceMount hidden={ui.activeTab !== 'plots'}>
                <div className="p-4 h-full">
                  <TimeSeriesPlotECharts apiService={apiService} />
                </div>
              </TabsContent>

              <TabsContent value="analysis" className="m-0 h-full" forceMount hidden={ui.activeTab !== 'analysis'}>
                <div className="p-4 h-full">
                  <DDAAnalysis apiService={apiService} />
                </div>
              </TabsContent>

              <TabsContent value="results" className="m-0 h-full" forceMount hidden={ui.activeTab !== 'results'}>
                <div className="p-4 h-full">
                  {currentAnalysis ? (
                    // Only render DDAResults when tab is actually visible to prevent lag
                    ui.activeTab === 'results' ? (
                      <DDAResults result={currentAnalysis} />
                    ) : null
                  ) : isLoadingHistory || !ui.isServerReady ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                        <h3 className="text-lg font-medium mb-2">
                          {!ui.isServerReady ? 'Starting Server...' : 'Loading Analysis History'}
                        </h3>
                        <p className="text-muted-foreground">
                          {!ui.isServerReady ? 'Please wait while the analysis server starts' : 'Fetching saved analyses...'}
                        </p>
                      </div>
                    </div>
                  ) : isAutoLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                        <h3 className="text-lg font-medium mb-2">
                          Loading Analysis Results
                        </h3>
                        <p className="text-muted-foreground">
                          Fetching the most recent analysis from database...
                        </p>
                      </div>
                    </div>
                  ) : analysisHistory.length > 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <Settings className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-medium mb-2">
                          Analysis Available
                        </h3>
                        <p className="text-muted-foreground mb-4">
                          Found {analysisHistory.length} analysis
                          {analysisHistory.length > 1 ? "es" : ""} in
                          history
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Switch to the DDA Analysis tab to view results
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <Settings className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-medium mb-2">
                          No Analysis Results
                        </h3>
                        <p className="text-muted-foreground">
                          Run a DDA analysis to see results here
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="annotations" className="m-0 h-full" forceMount hidden={ui.activeTab !== 'annotations'}>
                <AnnotationsTab />
              </TabsContent>

              <TabsContent value="openneuro" className="m-0 h-full" forceMount hidden={ui.activeTab !== 'openneuro'}>
                <div className="h-full p-6">
                  <OpenNeuroBrowser />
                </div>
              </TabsContent>

              {TauriService.isTauri() && (
                <TabsContent value="nsg" className="m-0 h-full" forceMount hidden={ui.activeTab !== 'nsg'}>
                  <div className="h-full">
                    <NSGJobManager />
                  </div>
                </TabsContent>
              )}

              {TauriService.isTauri() && (
                <TabsContent value="notifications" className="m-0 h-full" forceMount hidden={ui.activeTab !== 'notifications'}>
                  <div className="h-full p-6 overflow-auto">
                    <NotificationHistory onNavigate={handleNotificationNavigate} />
                  </div>
                </TabsContent>
              )}

              <TabsContent value="settings" className="m-0 h-full" forceMount hidden={ui.activeTab !== 'settings'}>
                <div className="h-full">
                  <SettingsPanel />
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>

      {/* Health Status Bar */}
      <HealthStatusBar apiService={apiService} />

      {/* Global DDA Progress Indicator - visible on all tabs */}
      <DDAProgressIndicator />
    </div>
  );
}
