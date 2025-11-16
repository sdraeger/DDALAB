"use client";

import { useState, useEffect, useMemo, useRef, startTransition } from "react";
import { useAppStore } from "@/store/appStore";
import { ApiService } from "@/services/apiService";
import { DDAResult } from "@/types/api";
import {
  useDDAHistory,
  useDeleteAnalysis,
  useRenameAnalysis,
  useAnalysisFromHistory,
} from "@/hooks/useDDAAnalysis";
import { DDAHistorySidebar } from "./DDAHistorySidebar";
import { DDAAnalysis } from "@/components/DDAAnalysis";
import { DDAResults } from "@/components/DDAResults";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, Settings, BarChart3, Cloud, ArrowLeft } from "lucide-react";

interface DDAWithHistoryProps {
  apiService: ApiService;
}

export function DDAWithHistory({ apiService }: DDAWithHistoryProps) {
  // Only select the specific properties we need, not entire objects
  // This prevents re-renders when other properties change
  const currentFilePath = useAppStore(
    (state) => state.fileManager.selectedFile?.file_path,
  );
  const currentAnalysisId = useAppStore(
    (state) => state.dda.currentAnalysis?.id,
  );
  const currentAnalysisFilePath = useAppStore(
    (state) => state.dda.currentAnalysis?.file_path,
  );
  const currentAnalysis = useAppStore((state) => state.dda.currentAnalysis);
  const hasPreviousAnalysis = useAppStore(
    (state) => !!state.dda.previousAnalysis,
  );
  const setCurrentAnalysis = useAppStore((state) => state.setCurrentAnalysis);
  const restorePreviousAnalysis = useAppStore(
    (state) => state.restorePreviousAnalysis,
  );
  const isServerReady = useAppStore((state) => state.ui.isServerReady);

  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(
    null,
  );
  // Deferred mounting to prevent UI freeze
  const [showResults, setShowResults] = useState(false);
  const [activeTab, setActiveTab] = useState<"configure" | "results">(
    "configure",
  );
  const isSettingAnalysis = useRef(false);

  // Fetch history from server using TanStack Query
  const {
    data: allHistory,
    isLoading: historyLoading,
    refetch: refetchHistory,
  } = useDDAHistory(
    apiService,
    isServerReady && !!apiService.getSessionToken(),
  );

  // Memoize filtered history to prevent unnecessary re-renders
  const fileHistory = useMemo(
    () =>
      allHistory?.filter((item) => item.file_path === currentFilePath) || [],
    [allHistory, currentFilePath],
  );

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

  // Initialize selected ID when current analysis changes or file changes
  useEffect(() => {
    if (currentAnalysisFilePath === currentFilePath && currentAnalysisId) {
      // Only update if actually different to prevent unnecessary state updates
      if (selectedAnalysisId !== currentAnalysisId) {
        setSelectedAnalysisId(currentAnalysisId);
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
      setSelectedAnalysisId(null);
    }
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

    // Skip if this analysis is already the current one (prevents duplicate calls from DashboardLayout)
    if (currentAnalysisId === selectedAnalysisData.id) {
      console.log(
        "[DDA HISTORY] Analysis already set as current, skipping duplicate setCurrentAnalysis call",
      );
      lastSetAnalysisId.current = selectedAnalysisData.id;
      return;
    }

    // Prevent concurrent calls
    if (isSettingAnalysis.current) {
      return;
    }

    isSettingAnalysis.current = true;
    console.log("[DDA HISTORY] Setting loaded analysis as current:", {
      id: selectedAnalysisData.id,
      hasResults: !!selectedAnalysisData.results,
      hasScales: !!selectedAnalysisData.results?.scales,
      scalesLength: selectedAnalysisData.results?.scales?.length,
      variantsCount: selectedAnalysisData.results?.variants?.length,
      firstVariantId: selectedAnalysisData.results?.variants?.[0]?.variant_id,
      hasMatrixData: !!selectedAnalysisData.results?.variants?.[0]?.dda_matrix,
      matrixChannels: selectedAnalysisData.results?.variants?.[0]?.dda_matrix
        ? Object.keys(selectedAnalysisData.results.variants[0].dda_matrix)
            .length
        : 0,
    });

    setCurrentAnalysis(selectedAnalysisData);
    lastSetAnalysisId.current = selectedAnalysisData.id;

    // Use setTimeout to break out of sync rendering
    setTimeout(() => {
      isSettingAnalysis.current = false;
    }, 0);
  }, [selectedAnalysisData?.id]); // Only depend on selected analysis ID, not current analysis

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

  const displayAnalysis = useMemo(() => {
    let result: DDAResult | null = null;

    // Determine which analysis to display
    if (selectedAnalysisData) {
      result = selectedAnalysisData;
    } else if (currentAnalysis?.id === selectedAnalysisId) {
      result = currentAnalysis;
    }

    // CRITICAL: If the ID is the same as before, return the previous reference
    // This prevents mount/unmount thrashing when parent re-renders with new object references
    if (result && prevDisplayAnalysisRef.current?.id === result.id) {
      console.log("[DDA HISTORY] Same ID, returning previous reference:", result.id);
      return prevDisplayAnalysisRef.current;
    }

    // New ID or null, update the ref and return new result
    if (result?.id !== prevDisplayAnalysisRef.current?.id) {
      console.log("[DDA HISTORY] New ID, updating reference:", {
        prev: prevDisplayAnalysisRef.current?.id,
        next: result?.id,
      });
    }
    prevDisplayAnalysisRef.current = result;
    return result;
  }, [
    selectedAnalysisData, // Must include full object to avoid stale closure
    currentAnalysis,      // Must include full object to avoid stale closure
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
        onToggleCollapse={() => setIsHistoryCollapsed(!isHistoryCollapsed)}
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
            className="flex-1 min-h-0 overflow-auto m-0"
          >
            <div className="p-4 h-full">
              <DDAAnalysis apiService={apiService} />
            </div>
          </TabsContent>

          <TabsContent
            value="results"
            className="flex-1 min-h-0 overflow-auto m-0"
          >
            {displayAnalysis ? (
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
                    {(isLoadingAnalysis || isFetchingAnalysis) && selectedAnalysisId && (
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
                    {displayAnalysis.source === "nsg" && hasPreviousAnalysis && (
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
                    <DDAResults
                      key={displayAnalysis.id}
                      result={displayAnalysis}
                    />
                  </>
                )}
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
