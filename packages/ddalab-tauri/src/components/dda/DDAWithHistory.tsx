"use client";

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  startTransition,
  useDeferredValue,
  lazy,
  Suspense,
} from "react";
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
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, Settings, BarChart3, Cloud, ArrowLeft } from "lucide-react";
import { createLogger } from "@/lib/logger";
import { normalizePath } from "@/utils/channelUtils";
import { wasmHeatmapWorker } from "@/services/wasmHeatmapWorkerService";

// Pre-warm the heatmap worker when hovering over Results tab
// This reduces cold-start latency when viewing results
const handleResultsTabHover = () => {
  wasmHeatmapWorker.warmup().catch(() => {
    // Ignore warmup errors - worker will be initialized on first use anyway
  });
};

// Lazy load DDAResults to defer heavy bundle loading until results tab is viewed
// This significantly reduces initial render blocking
const DDAResults = lazy(() =>
  import("@/components/DDAResults").then((mod) => ({
    default: mod.DDAResults,
  })),
);

const logger = createLogger("DDAHistory");

export function DDAWithHistory() {
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
  const historyEnabled = isServerReady;

  const {
    data: allHistory,
    isLoading: historyLoading,
    refetch: refetchHistory,
  } = useDDAHistory(historyEnabled);

  // Sync TanStack Query history to Zustand store for global search
  useEffect(() => {
    if (allHistory && allHistory.length > 0) {
      setAnalysisHistory(allHistory);
    }
  }, [allHistory, setAnalysisHistory]);

  // Handle pending analysis ID from global search
  useEffect(() => {
    if (pendingAnalysisId && pendingAnalysisId !== selectedAnalysisId) {
      logger.debug("Loading analysis from global search", {
        pendingAnalysisId,
      });
      setSelectedAnalysisId(pendingAnalysisId);
      setActiveTab("results");
      // Clear the pending ID after processing
      setPendingAnalysisId(null);
    }
  }, [pendingAnalysisId, selectedAnalysisId, setPendingAnalysisId]);

  // Memoize filtered history to prevent unnecessary re-renders
  const fileHistory = useMemo(() => {
    const normalizedCurrentPath = normalizePath(currentFilePath);
    return (
      allHistory?.filter(
        (item) => normalizePath(item.file_path) === normalizedCurrentPath,
      ) || []
    );
  }, [allHistory, currentFilePath]);

  // Track if user has explicitly requested results (clicked history item or switched to results tab)
  // This prevents auto-loading heavy data on initial tab visit
  const [userRequestedResults, setUserRequestedResults] = useState(false);

  // Fetch full analysis data when:
  // 1. A history item is selected AND
  // 2. Either:
  //    a. It's different from the current analysis, OR
  //    b. Current analysis data is not actually loaded (just the ID from persistence)
  // 3. User has explicitly requested to view results (not just auto-select on tab open)
  // This defers the heavy JSON parsing until user actually wants to see results
  const needsToFetch =
    selectedAnalysisId !== currentAnalysisId ||
    (selectedAnalysisId === currentAnalysisId && !currentAnalysis?.results);

  const shouldLoadFullData =
    !!selectedAnalysisId &&
    needsToFetch &&
    (userRequestedResults || activeTab === "results");

  const {
    data: rawSelectedAnalysisData,
    isLoading: isLoadingAnalysis,
    isFetching: isFetchingAnalysis,
  } = useAnalysisFromHistory(selectedAnalysisId, shouldLoadFullData);

  // PERF: Defer the heavy analysis data to prevent UI blocking during React updates
  // This allows the loading spinner to remain responsive while data is processed
  const selectedAnalysisData = useDeferredValue(rawSelectedAnalysisData);

  // Track if we're showing stale data while new data is being processed
  const isProcessingData = rawSelectedAnalysisData !== selectedAnalysisData;

  // Mutations
  const deleteAnalysisMutation = useDeleteAnalysis();
  const renameAnalysisMutation = useRenameAnalysis();

  // Track previous currentAnalysisId to detect actual changes
  const prevCurrentAnalysisId = useRef<string | null | undefined>(null);

  // Initialize selected ID when current analysis changes or file changes
  useEffect(() => {
    // Check if currentAnalysisId actually changed (not just a re-render)
    const currentAnalysisIdChanged =
      prevCurrentAnalysisId.current !== currentAnalysisId;
    const filePathsMatch = currentAnalysisFilePath === currentFilePath;

    if (filePathsMatch && currentAnalysisId) {
      // ONLY sync when currentAnalysisId actually changed (new analysis completed)
      // This prevents overriding the user's manual selection from history
      if (
        currentAnalysisIdChanged &&
        selectedAnalysisId !== currentAnalysisId
      ) {
        logger.debug("Syncing selection to current analysis", {
          currentAnalysisId: currentAnalysisId?.slice(0, 8),
        });
        setSelectedAnalysisId(currentAnalysisId);
      }
    } else if (!currentAnalysisId && fileHistory.length > 0) {
      // Auto-select most recent for this file
      const mostRecentId = fileHistory[0].id;
      if (selectedAnalysisId !== mostRecentId) {
        logger.debug("Auto-selecting most recent analysis", { mostRecentId });
        setSelectedAnalysisId(mostRecentId);
      }
    } else if (!currentAnalysisId && selectedAnalysisId !== null) {
      logger.debug("Clearing selection (no current analysis)");
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
    if (!selectedAnalysisData) return;

    // Skip if this is the same analysis we just set (prevents duplicate calls)
    if (lastSetAnalysisId.current === selectedAnalysisData.id) return;

    // Skip if this analysis is already the current one (prevents duplicate calls)
    if (currentAnalysisId === selectedAnalysisData.id) {
      lastSetAnalysisId.current = selectedAnalysisData.id;
      return;
    }

    // Set state with transition to keep UI responsive
    startTransition(() => {
      setCurrentAnalysis(selectedAnalysisData);
    });
    lastSetAnalysisId.current = selectedAnalysisData.id;
  }, [selectedAnalysisData?.id, currentAnalysisId, setCurrentAnalysis]);

  const handleSelectAnalysis = (analysis: DDAResult) => {
    // Prevent multiple clicks while loading
    if (isLoadingAnalysis || isFetchingAnalysis) {
      return;
    }

    logger.debug("Selecting analysis", { id: analysis.id });

    // Mark that user explicitly requested results (enables full data loading)
    // This must happen even if the analysis is already selected (e.g., by auto-select)
    setUserRequestedResults(true);

    // If already selected, just switch to results tab
    if (selectedAnalysisId === analysis.id) {
      startTransition(() => {
        setActiveTab("results");
      });
      return;
    }

    // CRITICAL: Switch to results tab FIRST to show loading overlay
    // Then use RAF to yield to the browser before triggering the fetch
    // This ensures the loading spinner renders and animates before
    // Tauri's JSON deserialization blocks the main thread
    setActiveTab("results");

    // Use double RAF to ensure the loading overlay is painted
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        startTransition(() => {
          setSelectedAnalysisId(analysis.id);
        });
      });
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
      logger.error("Failed to delete analysis", { error });
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
      logger.error("Failed to rename analysis", { error });
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
  // Use startTransition to mark this as non-urgent, allowing the browser to paint first
  useEffect(() => {
    if (currentAnalysis && currentAnalysis.status === "completed") {
      startTransition(() => {
        setActiveTab("results");
      });
    }
  }, [currentAnalysisId]);

  // Show results immediately when analysis is available
  // The data loading already happens off-thread, no need for artificial delays
  useEffect(() => {
    if (displayAnalysis) {
      const t0 = performance.now();
      console.log(
        `[DDA UI] displayAnalysis changed to id=${displayAnalysis.id.slice(0, 8)}, showing results`,
      );
      // Use requestAnimationFrame to batch with next paint, avoiding layout thrashing
      const rafId = requestAnimationFrame(() => {
        startTransition(() => {
          setShowResults(true);
          console.log(
            `[DDA UI] setShowResults(true) at t=${(performance.now() - t0).toFixed(1)}ms`,
          );
        });
      });
      return () => cancelAnimationFrame(rafId);
    } else {
      setShowResults(false);
    }
  }, [displayAnalysis?.id]);

  // Debug log when display analysis changes (only log ID to reduce noise)
  useEffect(() => {
    if (displayAnalysis?.id) {
      logger.debug("Display analysis changed", { id: displayAnalysis.id });
    }
  }, [displayAnalysis?.id]);

  return (
    <div className="flex h-full">
      {/* History Sidebar */}
      <DDAHistorySidebar
        history={fileHistory}
        currentAnalysisId={currentAnalysisId || null}
        selectedAnalysisId={selectedAnalysisId}
        isLoading={
          historyLoading ||
          isLoadingAnalysis ||
          isFetchingAnalysis ||
          isProcessingData
        }
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
              onMouseEnter={handleResultsTabHover}
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
                <DDAAnalysis />
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
            {/* Also show during data processing (structured clone from worker) */}
            {!displayAnalysis &&
            (isLoadingAnalysis || isFetchingAnalysis || isProcessingData) &&
            selectedAnalysisId ? (
              <div className="flex items-center justify-center h-full min-h-[400px]">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
                  <p className="text-sm text-muted-foreground">
                    {isProcessingData
                      ? "Processing analysis data..."
                      : "Loading analysis..."}
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
                    {/* Loading overlay for fetching/processing data */}
                    {(isLoadingAnalysis ||
                      isFetchingAnalysis ||
                      isProcessingData) &&
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
                    {/* Suspense wrapper for lazy-loaded DDAResults */}
                    <ErrorBoundary key={displayAnalysis.id}>
                      <Suspense
                        fallback={
                          <div className="flex items-center justify-center min-h-[400px]">
                            <div className="text-center">
                              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
                              <p className="text-sm text-muted-foreground">
                                Loading visualization components...
                              </p>
                            </div>
                          </div>
                        }
                      >
                        <DDAResults result={displayAnalysis} />
                      </Suspense>
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
