"use client";

import { useState, useEffect, useMemo, useRef, startTransition } from "react";
import { ApiService } from "@/services/apiService";
import { DDAResult } from "@/types/api";
import { useScrollTrap } from "@/hooks/useScrollTrap";
import { useDDAWithHistoryState } from "@/store/selectors";
import {
  useDDAHistory,
  useDeleteAnalysis,
  useRenameAnalysis,
  useAnalysisFromHistory,
} from "@/hooks/useDDAAnalysis";
import { DDAHistorySidebar } from "./DDAHistorySidebar";
import { DDAAnalysis } from "@/components/DDAAnalysis";
import { DDAResults } from "@/components/DDAResults";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, Settings, BarChart3, Cloud, ArrowLeft } from "lucide-react";

interface DDAWithHistoryProps {
  apiService: ApiService;
}

export function DDAWithHistory({ apiService }: DDAWithHistoryProps) {
  // Consolidated state selector - single subscription instead of 16 separate ones
  // Uses useShallow for shallow equality comparison to minimize re-renders
  const {
    currentFilePath,
    currentAnalysisId,
    currentAnalysisFilePath,
    currentAnalysis,
    hasPreviousAnalysis,
    isRunning: ddaRunning,
    pendingAnalysisId,
    isServerReady,
    isHistoryCollapsed,
    ddaActiveTab: activeTab,
    setCurrentAnalysis,
    restorePreviousAnalysis,
    setAnalysisHistory,
    setPendingAnalysisId,
    togglePanelCollapsed,
    setDDAActiveTab: setActiveTab,
  } = useDDAWithHistoryState();

  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(
    null,
  );
  // Deferred mounting to prevent UI freeze
  const [showResults, setShowResults] = useState(false);

  // Scroll traps for configure and results tabs
  const {
    containerProps: configScrollProps,
    isScrollEnabled: isConfigScrollEnabled,
  } = useScrollTrap({ activationDelay: 100 });
  const {
    containerProps: resultsScrollProps,
    isScrollEnabled: isResultsScrollEnabled,
  } = useScrollTrap({ activationDelay: 100 });

  // Fetch history from server using TanStack Query
  const historyEnabled = isServerReady && !!apiService.getSessionToken();

  const {
    data: allHistory,
    isLoading: historyLoading,
    refetch: refetchHistory,
  } = useDDAHistory(apiService, historyEnabled);

  // Sync TanStack Query history to Zustand store for global search
  useEffect(() => {
    if (allHistory && allHistory.length > 0) {
      setAnalysisHistory(allHistory);
    }
  }, [allHistory, setAnalysisHistory]);

  // Handle pending analysis ID from global search
  useEffect(() => {
    if (pendingAnalysisId && pendingAnalysisId !== selectedAnalysisId) {
      console.log(
        "[DDA HISTORY] Loading analysis from global search:",
        pendingAnalysisId,
      );
      setSelectedAnalysisId(pendingAnalysisId);
      setActiveTab("results");
      // Clear the pending ID after processing
      setPendingAnalysisId(null);
    }
  }, [pendingAnalysisId, selectedAnalysisId, setPendingAnalysisId]);

  // Memoize filtered history to prevent unnecessary re-renders
  const fileHistory = useMemo(() => {
    // Normalize path for comparison (handle trailing slashes, backslashes, etc.)
    const normalizePath = (path: string | undefined | null): string => {
      if (!path) return "";
      return path.replace(/\\/g, "/").replace(/\/+$/, "");
    };

    const normalizedCurrentPath = normalizePath(currentFilePath);
    return (
      allHistory?.filter(
        (item) => normalizePath(item.file_path) === normalizedCurrentPath,
      ) || []
    );
  }, [allHistory, currentFilePath]);

  // Fetch full analysis data when a history item is selected
  // TanStack Query will cache this and prevent duplicate requests
  const {
    data: selectedAnalysisData,
    isLoading: isLoadingAnalysis,
    isFetching: isFetchingAnalysis,
  } = useAnalysisFromHistory(
    apiService,
    selectedAnalysisId,
    !!selectedAnalysisId && selectedAnalysisId !== currentAnalysisId,
  );

  // Mutations
  const deleteAnalysisMutation = useDeleteAnalysis(apiService);
  const renameAnalysisMutation = useRenameAnalysis(apiService);

  // Track previous currentAnalysisId to detect actual changes
  const prevCurrentAnalysisId = useRef<string | null | undefined>(null);

  // Initialize selected ID when current analysis changes or file changes
  useEffect(() => {
    // Check if currentAnalysisId actually changed (not just a re-render)
    const currentAnalysisIdChanged =
      prevCurrentAnalysisId.current !== currentAnalysisId;

    console.log("[DDA HISTORY SYNC]");
    console.log("  currentAnalysisId:", currentAnalysisId);
    console.log("  selectedAnalysisId:", selectedAnalysisId);
    console.log("  prevCurrentAnalysisId:", prevCurrentAnalysisId.current);
    console.log("  currentAnalysisIdChanged:", currentAnalysisIdChanged);
    console.log("  currentAnalysisFilePath:", currentAnalysisFilePath);
    console.log("  currentFilePath:", currentFilePath);
    console.log(
      "  filePathsMatch:",
      currentAnalysisFilePath === currentFilePath,
    );

    if (currentAnalysisFilePath === currentFilePath && currentAnalysisId) {
      // ONLY sync when currentAnalysisId actually changed (new analysis completed)
      // This prevents overriding the user's manual selection from history
      if (
        currentAnalysisIdChanged &&
        selectedAnalysisId !== currentAnalysisId
      ) {
        console.log(
          "[DDA HISTORY] Syncing selectedAnalysisId to currentAnalysisId:",
          currentAnalysisId,
          "( changed:",
          currentAnalysisIdChanged,
          ")",
        );
        setSelectedAnalysisId(currentAnalysisId);
      } else if (selectedAnalysisId === currentAnalysisId) {
        console.log("[DDA HISTORY] Already in sync:", {
          currentAnalysisId: currentAnalysisId?.slice(0, 8),
          selectedAnalysisId: selectedAnalysisId?.slice(0, 8),
        });
      } else {
        console.log(
          "[DDA HISTORY] User has different selection, not overriding:",
          {
            currentAnalysisId: currentAnalysisId?.slice(0, 8),
            selectedAnalysisId: selectedAnalysisId?.slice(0, 8),
          },
        );
      }
    } else if (!currentAnalysisId && fileHistory.length > 0) {
      // Auto-select most recent for this file
      // Re-enabled now that backend is optimized (<50ms instead of 9s)
      const mostRecentId = fileHistory[0].id;
      if (selectedAnalysisId !== mostRecentId) {
        console.log(
          "[DDA HISTORY] Auto-selecting most recent analysis:",
          mostRecentId,
        );
        setSelectedAnalysisId(mostRecentId);
      }
    } else if (!currentAnalysisId && selectedAnalysisId !== null) {
      console.log(
        "[DDA HISTORY] Clearing selectedAnalysisId (no current analysis)",
      );
      setSelectedAnalysisId(null);
    }

    // CRITICAL: Update ref AFTER condition checks to avoid missing rapid successive updates
    prevCurrentAnalysisId.current = currentAnalysisId;
  }, [
    currentAnalysisId,
    currentAnalysisFilePath,
    currentFilePath,
    selectedAnalysisId,
    fileHistory,
  ]);

  // Update store when full analysis data is loaded
  // CRITICAL FIX: Only call setCurrentAnalysis when the analysis ID actually changes
  // DashboardLayout handles initial auto-load, so we only need to handle manual selection changes
  const lastSetAnalysisId = useRef<string | null>(null);

  useEffect(() => {
    // Skip if no selected analysis data
    if (!selectedAnalysisData) {
      return;
    }

    // Skip if this is the same analysis we just set (prevents duplicate calls)
    if (lastSetAnalysisId.current === selectedAnalysisData.id) {
      return;
    }

    // Skip if this analysis is already the current one (prevents duplicate calls)
    if (currentAnalysisId === selectedAnalysisData.id) {
      lastSetAnalysisId.current = selectedAnalysisData.id;
      return;
    }

    // Set the loaded analysis as current
    setCurrentAnalysis(selectedAnalysisData);
    lastSetAnalysisId.current = selectedAnalysisData.id;
  }, [selectedAnalysisData?.id, currentAnalysisId, setCurrentAnalysis]);

  const handleSelectAnalysis = (analysis: DDAResult) => {
    // Prevent multiple clicks while loading
    if (isLoadingAnalysis || isFetchingAnalysis) {
      console.log("[DDA] Already loading, ignoring click");
      return;
    }

    // Don't re-select the same analysis
    if (selectedAnalysisId === analysis.id) {
      console.log("[DDA] Analysis already selected:", analysis.id);
      return;
    }

    console.log("[DDA] Selecting analysis:", analysis.id);

    // Use startTransition to mark this update as non-urgent
    // This keeps the UI responsive during analysis switching
    startTransition(() => {
      setSelectedAnalysisId(analysis.id);
      // Switch to Results tab when selecting from history
      setActiveTab("results");
    });
  };

  const handleDeleteAnalysis = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!confirm("Are you sure you want to delete this analysis?")) {
      return;
    }

    try {
      await deleteAnalysisMutation.mutateAsync(id);

      // If we deleted the selected analysis, clear selection
      if (selectedAnalysisId === id) {
        setSelectedAnalysisId(null);
        setCurrentAnalysis(null);
      }

      // Refresh history
      await refetchHistory();
    } catch (error) {
      console.error("[DDA] Failed to delete analysis:", error);
    }
  };

  const handleRenameAnalysis = async (id: string, name: string) => {
    try {
      await renameAnalysisMutation.mutateAsync({
        analysisId: id,
        newName: name,
      });
      await refetchHistory();
    } catch (error) {
      console.error("[DDA] Failed to rename analysis:", error);
    }
  };

  // Determine what to display - HEAVILY MEMOIZED to prevent excessive re-renders of DDAResults
  // Keep showing current analysis while new one loads to prevent flash of empty state
  // CRITICAL FIX: Maintain stable object reference when ID hasn't changed
  const prevDisplayAnalysisRef = useRef<DDAResult | null>(null);

  // Keep refs to current values to avoid stale closures while keeping deps minimal
  const currentAnalysisRef = useRef(currentAnalysis);
  const selectedAnalysisDataRef = useRef(selectedAnalysisData);
  currentAnalysisRef.current = currentAnalysis;
  selectedAnalysisDataRef.current = selectedAnalysisData;

  const displayAnalysis = useMemo(() => {
    // Access current values via refs to get latest data
    const analysis = currentAnalysisRef.current;
    const selectedData = selectedAnalysisDataRef.current;

    let result: DDAResult | null = null;

    // Determine which analysis to display
    // CRITICAL: Check currentAnalysis first when IDs match to avoid using stale cached data
    // When a new analysis completes, currentAnalysis has the fresh data while
    // selectedAnalysisData may still have old cached data from a previous fetch
    if (analysis?.id === selectedAnalysisId) {
      result = analysis;
    } else if (selectedData) {
      result = selectedData;
    }

    // CRITICAL: If the ID is the same as before, return the previous reference
    // This prevents mount/unmount thrashing when parent re-renders with new object references
    if (result && prevDisplayAnalysisRef.current?.id === result.id) {
      return prevDisplayAnalysisRef.current;
    }

    // New ID or null, update the ref and return new result
    prevDisplayAnalysisRef.current = result;
    return result;
  }, [
    // Only depend on IDs - actual objects accessed via refs
    currentAnalysisId,
    selectedAnalysisData?.id,
    selectedAnalysisId,
  ]);

  // Auto-switch to Results tab when a new analysis completes
  useEffect(() => {
    if (currentAnalysis && currentAnalysis.status === "completed") {
      setActiveTab("results");
    }
  }, [currentAnalysisId]);

  // CRITICAL FIX: Deferred mounting to prevent UI freeze
  // When analysis changes, hide results first, then show on next frame
  // This allows browser to paint loading state before mounting heavy component
  useEffect(() => {
    if (displayAnalysis) {
      // Hide results immediately
      setShowResults(false);

      // Show results on next animation frame
      const rafId = requestAnimationFrame(() => {
        setShowResults(true);
      });

      return () => cancelAnimationFrame(rafId);
    } else {
      setShowResults(false);
    }
  }, [displayAnalysis?.id]);

  // Log what we're about to display
  useEffect(() => {
    console.log("[DDA HISTORY] Display state changed:", {
      selectedAnalysisId,
      currentAnalysisId,
      hasDisplayAnalysis: !!displayAnalysis,
      displayAnalysisId: displayAnalysis?.id,
      displaySource:
        displayAnalysis?.id === currentAnalysisId
          ? "currentAnalysis"
          : "selectedAnalysisData",
      hasResultsData: !!displayAnalysis?.results,
      hasScales: !!displayAnalysis?.results?.scales,
      scalesLength: displayAnalysis?.results?.scales?.length,
      variantsCount: displayAnalysis?.results?.variants?.length,
      hasMatrixData: !!displayAnalysis?.results?.variants?.[0]?.dda_matrix,
      matrixChannels: displayAnalysis?.results?.variants?.[0]?.dda_matrix
        ? Object.keys(displayAnalysis.results.variants[0].dda_matrix).length
        : 0,
      isLoadingAnalysis,
      isFetchingAnalysis,
    });
  }, [
    displayAnalysis?.id,
    selectedAnalysisId,
    isLoadingAnalysis,
    isFetchingAnalysis,
  ]);

  return (
    <div className="flex h-full">
      {/* History Sidebar */}
      <DDAHistorySidebar
        history={fileHistory}
        currentAnalysisId={currentAnalysisId || null}
        selectedAnalysisId={selectedAnalysisId}
        isLoading={historyLoading || isLoadingAnalysis || isFetchingAnalysis}
        isCollapsed={isHistoryCollapsed}
        onToggleCollapse={() => togglePanelCollapsed("dda-history")}
        onSelectAnalysis={handleSelectAnalysis}
        onDeleteAnalysis={handleDeleteAnalysis}
        onRenameAnalysis={handleRenameAnalysis}
        onRefresh={() => refetchHistory()}
      />

      {/* Main Content with Tabs */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as "configure" | "results")}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="flex-shrink-0 mx-4 mt-4">
            <TabsTrigger value="configure" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Configure
            </TabsTrigger>
            <TabsTrigger
              value="results"
              className="flex items-center gap-2"
              disabled={!displayAnalysis}
            >
              <BarChart3 className="h-4 w-4" />
              Results
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="configure"
            className={`flex-1 min-h-0 m-0 ${isConfigScrollEnabled ? "overflow-auto" : "overflow-hidden"}`}
            ref={configScrollProps.ref}
            onMouseEnter={configScrollProps.onMouseEnter}
            onMouseLeave={configScrollProps.onMouseLeave}
            style={configScrollProps.style}
          >
            <div className="p-4 h-full">
              <ErrorBoundary>
                <DDAAnalysis apiService={apiService} />
              </ErrorBoundary>
            </div>
          </TabsContent>

          <TabsContent
            value="results"
            className={`flex-1 min-h-0 m-0 ${isResultsScrollEnabled ? "overflow-auto" : "overflow-hidden"}`}
            ref={resultsScrollProps.ref}
            onMouseEnter={resultsScrollProps.onMouseEnter}
            onMouseLeave={resultsScrollProps.onMouseLeave}
            style={resultsScrollProps.style}
          >
            {/* Show loading state when fetching from history (before displayAnalysis is available) */}
            {!displayAnalysis &&
            (isLoadingAnalysis || isFetchingAnalysis) &&
            selectedAnalysisId ? (
              <div className="flex items-center justify-center h-full min-h-[400px]">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
                  <p className="text-sm text-muted-foreground">
                    Loading analysis...
                  </p>
                </div>
              </div>
            ) : displayAnalysis ? (
              // Show results when analysis data is loaded
              // DDAResults is memoized and will efficiently update when result.id changes
              // CRITICAL FIX: Keep component mounted during loading to prevent mount/unmount thrashing
              <div className="p-4 space-y-4 relative">
                {/* Loading state shown FIRST before mounting heavy component */}
                {!showResults && (
                  <div className="flex items-center justify-center h-full min-h-[400px]">
                    <div className="text-center">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
                      <p className="text-sm text-muted-foreground">
                        Preparing analysis visualization...
                      </p>
                    </div>
                  </div>
                )}

                {/* Mount DDAResults only after RAF fires */}
                {showResults && (
                  <>
                    {/* Loading overlay for fetching data */}
                    {(isLoadingAnalysis || isFetchingAnalysis) &&
                      selectedAnalysisId && (
                        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center rounded-lg">
                          <div className="text-center">
                            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
                            <p className="text-sm text-muted-foreground">
                              Loading analysis...
                            </p>
                          </div>
                        </div>
                      )}

                    {/* NSG Results Indicator Banner */}
                    {displayAnalysis.source === "nsg" &&
                      hasPreviousAnalysis && (
                        <Alert className="border-blue-200 bg-blue-50">
                          <Cloud className="h-4 w-4 text-blue-600" />
                          <AlertDescription className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-blue-900">
                                <strong>Viewing NSG Results</strong> from job{" "}
                                {displayAnalysis.id.slice(0, 8)}
                              </span>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => restorePreviousAnalysis()}
                              className="ml-4 h-7 text-xs"
                            >
                              <ArrowLeft className="h-3 w-3 mr-1" />
                              Back to Previous Analysis
                            </Button>
                          </AlertDescription>
                        </Alert>
                      )}

                    {/* CRITICAL FIX: Add key prop to help React track component identity */}
                    <ErrorBoundary key={displayAnalysis.id}>
                      <DDAResults result={displayAnalysis} />
                    </ErrorBoundary>
                  </>
                )}
              </div>
            ) : ddaRunning ? (
              // Analysis is running - show persistent loading indicator
              <div className="flex items-center justify-center h-full min-h-[400px]">
                <div className="text-center">
                  <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
                  <p className="text-lg font-medium mb-2">
                    DDA Analysis Running
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Analysis is in progress. You'll receive a notification when
                    complete.
                  </p>
                  <p className="text-xs text-muted-foreground mt-4">
                    Feel free to switch tabs or continue working
                  </p>
                </div>
              </div>
            ) : (
              // No analysis available
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-muted-foreground">
                  <p>No analysis results available</p>
                  <p className="text-sm mt-2">
                    Run an analysis from the Configure tab
                  </p>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
