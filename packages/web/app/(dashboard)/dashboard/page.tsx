"use client";

import { useEffect, useState } from "react";
import { DashboardGrid } from "shared/components/dashboard/DashboardGrid";
import { DashboardToolbar } from "shared/components/dashboard/DashboardToolbar";
import { Button } from "shared/components/ui/button";
import { Save, RefreshCw, Trash2, Settings } from "lucide-react";
import { useToast } from "shared/components/ui/use-toast";
import { useUnifiedSessionData } from "shared/hooks";
import { useEDFPlot } from "shared/contexts/EDFPlotContext";
import {
  EdfMetadata,
  FileSelectionDialog,
} from "shared/components/dialog/FileSelectionDialog";
import { FileBrowserWidget } from "shared/components/dashboard/widgets/FileBrowserWidget";
import { useAppDispatch } from "shared/store";
import {
  ensurePlotState,
  initializePlot,
  loadChunk,
  setSelectedChannels,
  clearAllPlots,
} from "shared/store/slices/plotSlice";
import { apiRequest } from "shared/lib/utils/request";
import { DashboardStateManager } from "shared/components/ui/dashboard-state-manager";
import { useSelector } from "react-redux";
import {
  selectIsFileLoading,
  startLoading,
  stopLoading,
  clearAllLoading,
} from "shared/store/slices/loadingSlice";
import { useCurrentEdfFile } from "shared/hooks/useCurrentEdfFile";
import { useAuthMode } from "shared/contexts/AuthModeContext";
import {
  DashboardStateIntegration,
  useDashboardStateBridge,
} from "shared/components/state/DashboardStateIntegration";
import { DashboardWidget } from "shared/lib/state/examples/DashboardStateExample";
import { ChartWidget } from "shared/components/dashboard/widgets/ChartWidget";
import { DDAHeatmapWidget } from "shared/components/dashboard/widgets/DDAHeatmapWidget";
import { DDALinePlotWidget } from "shared/components/dashboard/widgets/DDALinePlotWidget";

interface Segment {
  start: { days: number; hours: number; minutes: number; seconds: number };
  end: { days: number; hours: number; minutes: number; seconds: number };
}

function timePartsToSeconds(tp: {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}): number {
  return (
    (tp.days || 0) * 86400 +
    (tp.hours || 0) * 3600 +
    (tp.minutes || 0) * 60 +
    (tp.seconds || 0)
  );
}

const EPSILON = 0.5; // seconds

export default function Dashboard() {
  const { data: session } = useUnifiedSessionData();
  const { toast } = useToast();
  const { setSelectedFilePath } = useEDFPlot();
  const dispatch = useAppDispatch();
  const { selectFile, currentFilePath } = useCurrentEdfFile();
  const { isLocalMode } = useAuthMode();
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);
  const isFileLoading = useSelector(selectIsFileLoading);

  // New state management integration
  const dashboardState = useDashboardStateBridge();

  // Debug logging for loading state
  useEffect(() => {
    console.log("[Dashboard] isFileLoading changed:", isFileLoading);

    // Also log the current loading operations for debugging
    const state = (window as any).__REDUX_STORE__?.getState?.();
    if (state?.loading?.operations) {
      const operations = Object.keys(state.loading.operations);
      if (operations.length > 0) {
        console.log("[Dashboard] Current loading operations:", operations);
        console.log(
          "[Dashboard] Loading operations details:",
          state.loading.operations
        );
      }
    }
  }, [isFileLoading]);

  // Clear any stuck loading operations on mount
  useEffect(() => {
    // Immediately clear all loading operations to ensure clean state
    dispatch(clearAllLoading());

    const clearStuckLoading = () => {
      // Get current loading state
      const state = (window as any).__REDUX_STORE__?.getState?.();
      if (state?.loading?.operations) {
        const operations = Object.keys(state.loading.operations);
        if (operations.length > 0) {
          console.log(
            "[Dashboard] Clearing stuck loading operations:",
            operations
          );
          // Clear all loading operations to ensure clean state
          dispatch(clearAllLoading());
        }
      }
    };

    // Clear stuck operations after a short delay to allow initial render
    const timeout = setTimeout(clearStuckLoading, 100);
    return () => clearTimeout(timeout);
  }, [dispatch]);

  const handleFileSelect = (filePath: string) => {
    console.log("[Dashboard] handleFileSelect called with:", filePath);

    // Open the channel selection dialog immediately
    setPendingFilePath(filePath);
    setChannelDialogOpen(true);

    console.log("[Dashboard] Dialog state set:", {
      pendingFilePath: filePath,
      channelDialogOpen: true,
      currentFilePath: currentFilePath,
    });
  };

  const handleDialogConfirm = async (
    filePath: string,
    selectedChannels: string[],
    metadata: EdfMetadata | null,
    segment: Segment
  ) => {
    console.log("[handleDialogConfirm] *** CALLED ***", {
      filePath,
      selectedChannels,
      hasMetadata: !!metadata,
      segment,
      hasSession: !!session,
      sessionStructure: session,
      hasAccessToken: !!session?.data?.accessToken,
      sessionKeys: session ? Object.keys(session) : null,
      sessionDataKeys: session?.data ? Object.keys(session.data) : null,
    });

    try {
      console.log("[handleDialogConfirm] Setting file paths...");
      setSelectedFilePath(filePath);
      selectFile(filePath);

      // Sync with new state management system
      await dashboardState.setCurrentFile(filePath);

      // Try multiple token extraction patterns
      const tokenOption1 = session?.data?.accessToken;
      const tokenOption2 = session?.accessToken;
      const tokenOption3 = (session as any)?.access_token;
      const token = tokenOption1 || tokenOption2 || tokenOption3;

      console.log("[handleDialogConfirm] Token extraction attempts:", {
        isLocalMode,
        tokenOption1: !!tokenOption1,
        tokenOption2: !!tokenOption2,
        tokenOption3: !!tokenOption3,
        finalToken: !!token,
        tokenLength: token?.length,
        tokenValue: token ? token.substring(0, 20) + "..." : "null",
      });

      if (!token && !isLocalMode) {
        console.log(
          "[handleDialogConfirm] No token and not in local mode, showing auth error"
        );
        toast({
          title: "Authentication Error",
          description: "Please log in to load files.",
          variant: "destructive",
        });
        return;
      }

      if (isLocalMode) {
        console.log(
          "[handleDialogConfirm] Local mode detected, proceeding without token requirement"
        );
      }

      // Start loading state immediately when dialog closes
      const loadingId = `file-load-${filePath}`;
      console.log("[handleDialogConfirm] Starting loading state:", loadingId);
      dispatch(
        startLoading({
          id: loadingId,
          type: "file-load",
          message: "Loading file data...",
          showGlobalOverlay: false,
        })
      );

      console.log("[handleDialogConfirm] About to start async operations...");
      try {
        // Start unified loading for the entire file selection process
        console.log("[handleDialogConfirm] Ensuring plot state...");
        dispatch(ensurePlotState(filePath));

        // Also initialize plot state in centralized system
        await dashboardState.setCurrentFile(filePath);
        console.log("[handleDialogConfirm] Updated centralized plot state");

        console.log("[handleDialogConfirm] Calling initializePlot...");
        const initResult = await dispatch(initializePlot({ filePath, token }));
        console.log("[handleDialogConfirm] initializePlot result:", initResult);

        if (initResult.meta.requestStatus !== "fulfilled") {
          console.error(
            "[handleDialogConfirm] initializePlot failed:",
            initResult
          );
          const errorMsg =
            (initResult as any)?.error?.message ||
            (initResult as any)?.error ||
            "Unknown error";
          toast({
            title: "Plot Initialization Error",
            description: `Failed to initialize plot: ${errorMsg}`,
            variant: "destructive",
          });
          return;
        }

        // Optionally, log Redux state for the filePath
        // (Assumes you have access to the Redux store, otherwise remove this block)
        try {
          const state = (window as any).__REDUX_STORE__?.getState?.();
          if (state) {
            console.log(
              "[handleDialogConfirm] Redux plot state after init:",
              state.plots?.byFilePath?.[filePath]
            );
          }
        } catch (e) {
          // Ignore if store is not available
        }

        const processedSegment: Segment = {
          start: {
            days: Math.floor(segment.start.days),
            hours: Math.floor(segment.start.hours),
            minutes: Math.floor(segment.start.minutes),
            seconds: Math.floor(segment.start.seconds),
          },
          end: {
            days: Math.floor(segment.end.days),
            hours: Math.floor(segment.end.hours),
            minutes: Math.floor(segment.end.minutes),
            seconds: Math.floor(segment.end.seconds),
          },
        };

        const needsSegmenting =
          Math.abs(timePartsToSeconds(segment.start) - 0) > EPSILON ||
          Math.abs(
            timePartsToSeconds(segment.end) - (metadata?.total_duration || 0)
          ) > EPSILON;

        if (needsSegmenting) {
          console.log("[handleDialogConfirm] segmenting file");
          filePath = await apiRequest<string>({
            url: `/api/edf/segment?file_path=${encodeURIComponent(filePath)}`,
            method: "POST",
            token,
            body: processedSegment,
            responseType: "json",
          });

          // After segmenting, initialize plot for the new filePath
          if (filePath) {
            // Update the current file path for the segmented file
            setSelectedFilePath(filePath);
            selectFile(filePath);

            // Update centralized state with segmented file path
            await dashboardState.setCurrentFile(filePath);

            const segmentInitResult = await dispatch(
              initializePlot({ filePath, token })
            );
            console.log(
              "[handleDialogConfirm] initializePlot (segmented) result:",
              segmentInitResult
            );

            if (segmentInitResult.meta.requestStatus !== "fulfilled") {
              console.error(
                "[handleDialogConfirm] initializePlot (segmented) failed:",
                segmentInitResult
              );
              const errorMsg =
                (segmentInitResult as any)?.error?.message ||
                (segmentInitResult as any)?.error ||
                "Unknown error";
              toast({
                title: "Plot Initialization Error",
                description: `Failed to initialize plot for segmented file: ${errorMsg}`,
                variant: "destructive",
              });
              return;
            }
          }
        } else {
          console.log("[handleDialogConfirm] no segmenting needed");
        }

        console.log("[handleDialogConfirm] filePath:", filePath);

        if (!filePath) {
          throw new Error("Failed to fetch segment");
        }

        console.log("[handleDialogConfirm] About to call loadChunk...");
        const loadChunkResult = await dispatch(
          loadChunk({ filePath, chunkNumber: 1, chunkSizeSeconds: 10, token })
        );
        console.log("[handleDialogConfirm] loadChunk result:", loadChunkResult);

        if (loadChunkResult.meta.requestStatus !== "fulfilled") {
          console.error(
            "[handleDialogConfirm] loadChunk failed:",
            loadChunkResult
          );
          throw new Error(
            `LoadChunk failed: ${(loadChunkResult as any)?.error?.message || "Unknown error"}`
          );
        }

        console.log("[handleDialogConfirm] Setting selected channels...");
        dispatch(setSelectedChannels({ filePath, channels: selectedChannels }));

        // Sync selected channels with new state management system
        await dashboardState.setSelectedChannels(selectedChannels);

        // Update time window based on segment if available
        if (metadata?.total_duration) {
          const startTime = timePartsToSeconds(segment.start);
          const endTime = timePartsToSeconds(segment.end);
          await dashboardState.setTimeWindow([startTime, endTime]);
        }

        // Debug: Check the final Redux state
        try {
          const finalState = (window as any).__REDUX_STORE__?.getState?.();
          if (finalState?.plots) {
            console.log("[handleDialogConfirm] Final Redux plots state:", {
              currentFilePath: finalState.plots.currentFilePath,
              plotKeys: Object.keys(finalState.plots.byFilePath || {}),
              selectedPlotState: finalState.plots.byFilePath?.[filePath],
              hasEdfData: !!finalState.plots.byFilePath?.[filePath]?.edfData,
              hasMetadata: !!finalState.plots.byFilePath?.[filePath]?.metadata,
              selectedChannels:
                finalState.plots.byFilePath?.[filePath]?.selectedChannels,
              edfDataStructure: finalState.plots.byFilePath?.[filePath]?.edfData
                ? {
                    channels:
                      finalState.plots.byFilePath?.[filePath]?.edfData?.channels
                        ?.length,
                    dataLength:
                      finalState.plots.byFilePath?.[filePath]?.edfData?.data
                        ?.length,
                    sampleRate:
                      finalState.plots.byFilePath?.[filePath]?.edfData
                        ?.sampleRate,
                  }
                : "No EDF data",
            });
          }
        } catch (e) {
          console.error("[handleDialogConfirm] Error checking final state:", e);
        }

        // Show success message
        toast({
          title: "File Loaded",
          description: `Successfully loaded ${filePath.split("/").pop()}`,
        });
      } catch (error) {
        console.error("Error loading file:", error);
        toast({
          title: "File Load Error",
          description: `Failed to load file: ${error instanceof Error ? error.message : "Unknown error"}`,
          variant: "destructive",
        });
      } finally {
        // Stop loading state
        dispatch(stopLoading(loadingId));
      }
    } catch (globalError) {
      console.error("[handleDialogConfirm] Global error:", globalError);
      toast({
        title: "Unexpected Error",
        description: `An unexpected error occurred: ${globalError instanceof Error ? globalError.message : "Unknown error"}`,
        variant: "destructive",
      });
    }
  };

  // Use centralized state management instead of old persistent dashboard hook
  const widgets = dashboardState.widgets;
  const isLoading = dashboardState.isLayoutLoading;
  const isSaving = false; // Auto-saving is handled by centralized state

  // Widget management functions using centralized state
  const addWidget = (widget: any) => {
    // DashboardToolbar passes a Widget object, we need to convert it
    return dashboardState.addWidget(widget);
  };
  const updateWidget = dashboardState.updateWidget;
  const removeWidget = dashboardState.removeWidget;

  // Legacy functions for popout/swapin - implement using centralized state
  const popOutWidget = async (id: string) => {
    await dashboardState.updateWidget(id, { isPopOut: true });
  };

  const swapInWidget = async (id: string) => {
    await dashboardState.updateWidget(id, { isPopOut: false });
  };

  // Layout save/load using centralized state (automatic persistence)
  const saveLayout = async () => {
    // No explicit save needed - centralized state auto-saves
    console.log("[Dashboard] Layout auto-saved by centralized state system");
  };

  const loadLayout = async () => {
    // Layout is automatically loaded by centralized state system
    console.log(
      "[Dashboard] Layout automatically loaded by centralized state system"
    );
  };

  const handleManualSave = async () => {
    try {
      await saveLayout();
    } catch (error) {
      // Error handling is done in the hook
    }
  };

  const handleManualLoad = async () => {
    try {
      await loadLayout();
      toast({
        title: "Layout Reloaded",
        description: "Your saved layout has been reloaded.",
        duration: 2000,
      });
    } catch (error) {
      // Error handling is done in the hook
    }
  };

  const handleClearLayout = async () => {
    try {
      // Use centralized state to clear layout
      await dashboardState.resetLayout();

      toast({
        title: "Layout Cleared",
        description: "Layout has been reset to default.",
        duration: 2000,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to clear layout.",
        variant: "destructive",
        duration: 3000,
      });
    }
  };

  return (
    <DashboardStateIntegration>
      <div className="w-full h-full flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 bg-background border-b">
          <DashboardToolbar
            onAddWidget={addWidget}
            className="flex-1"
            onFileSelect={handleFileSelect}
          />

          {/* Show channel settings when a file is loaded */}
          {currentFilePath && (
            <div className="flex items-center gap-2 ml-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPendingFilePath(currentFilePath);
                  setChannelDialogOpen(true);
                }}
                className="gap-1"
              >
                <Settings className="h-3 w-3" />
                Channel Settings
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  // Clear all state using centralized state system
                  setSelectedFilePath("");
                  selectFile("");
                  dispatch(clearAllPlots());

                  // Clear centralized state as well
                  await dashboardState.setCurrentFile(null);
                  await dashboardState.setSelectedChannels([]);

                  toast({
                    title: "State Cleared",
                    description: "All plot state has been cleared",
                  });
                }}
                className="gap-1 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
                Clear State
              </Button>
            </div>
          )}

          {/* Layout controls - show if user is logged in */}
          {session && (
            <div className="flex items-center gap-2 ml-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleManualSave}
                disabled={isSaving || !session}
                className="gap-1"
              >
                <Save className="h-3 w-3" />
                {isSaving ? "Saving..." : "Save Layout"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleManualLoad}
                disabled={isLoading}
                className="gap-1"
              >
                <RefreshCw className="h-3 w-3" />
                Reload
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearLayout}
                className="gap-1 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </Button>
            </div>
          )}
        </div>
        {/* Add persistent dashboard state view here */}
        <div className="px-4 py-2 bg-muted/10 border-b">
          <DashboardStateManager />
        </div>
        {/* Centralized State Management Demo */}
        {/* <div className="px-4 py-2 border-b">
					<FullStateDemo />
				</div> */}

        <div className="flex-1 overflow-auto relative p-6">
          {/* Loading overlay */}
          {isLoading && (
            <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
              <div className="text-center">
                <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Loading dashboard layout...
                </p>
              </div>
            </div>
          )}

          {/* Local loading overlay for file/plot loading */}
          {isFileLoading && (
            <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40 flex items-center justify-center">
              <div className="flex flex-col items-center bg-background/90 rounded-lg p-6 shadow-lg border">
                <RefreshCw className="h-8 w-8 animate-spin text-primary mb-3" />
                <span className="text-foreground font-medium">
                  Loading file data...
                </span>
              </div>
            </div>
          )}

          <DashboardGrid
            widgets={widgets.map((widget: DashboardWidget) => {
              // Convert centralized state widget to DashboardGrid format
              const gridWidget = {
                id: widget.id,
                title: widget.title,
                position: widget.position,
                size: widget.size,
                isPopOut: widget.isPopOut,
                type: widget.type,
                content: <div>Loading widget content...</div>, // Default content
              };

              // Add specific content based on widget type
              if (widget.type === "file-browser") {
                gridWidget.content = (
                  <FileBrowserWidget
                    onFileSelect={handleFileSelect}
                    maxHeight="100%"
                  />
                );
              } else if (widget.type === "chart") {
                gridWidget.content = (
                  <ChartWidget
                    widgetId={widget.id}
                    isPopout={widget.isPopOut}
                  />
                );
              } else if (widget.type === "dda-heatmap") {
                gridWidget.content = <DDAHeatmapWidget />;
              } else if (widget.type === "dda-line-plot") {
                gridWidget.content = (
                  <DDALinePlotWidget
                    widgetId={widget.id}
                    isPopout={widget.isPopOut}
                  />
                );
              } else if (widget.type === "test-widget") {
                gridWidget.content = (
                  <div className="p-4 text-center">
                    <h3 className="font-semibold mb-2">Test Widget</h3>
                    <p className="text-sm text-muted-foreground">
                      This is a test widget created by the state management
                      system
                    </p>
                  </div>
                );
              } else {
                // Default content for unknown widget types
                gridWidget.content = (
                  <div className="p-4 text-center">
                    <h3 className="font-semibold mb-2">Unknown Widget</h3>
                    <p className="text-sm text-muted-foreground">
                      Widget type "{widget.type}" is not supported
                    </p>
                  </div>
                );
              }

              return gridWidget;
            })}
            onWidgetUpdate={async (id, updates) => {
              await updateWidget(id, updates);
            }}
            onWidgetRemove={async (id) => {
              await removeWidget(id);
            }}
            onWidgetPopOut={popOutWidget}
            onWidgetSwapIn={swapInWidget}
            className="h-full"
            gridSize={dashboardState.gridSize}
            enableSnapping={dashboardState.enableSnapping}
            enableCollisionDetection={false}
          />

          {/* Auto-save indicator */}
          {isSaving && (
            <div className="absolute bottom-4 right-4 bg-primary text-primary-foreground px-3 py-1 rounded-md text-sm flex items-center gap-2">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Auto-saving...
            </div>
          )}

          {/* Channel Selection Dialog */}
          {pendingFilePath && (
            <FileSelectionDialog
              open={channelDialogOpen}
              onOpenChange={(open) => {
                setChannelDialogOpen(open);
                if (!open) setPendingFilePath(null);
              }}
              filePath={pendingFilePath}
              onConfirm={handleDialogConfirm}
            />
          )}
        </div>
      </div>
    </DashboardStateIntegration>
  );
}
