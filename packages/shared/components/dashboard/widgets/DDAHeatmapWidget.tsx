"use client";

import { useState, useEffect, useMemo } from "react";
import { useCurrentEdfFile } from "../../../hooks/useCurrentEdfFile";
import { Activity, Settings, RotateCcw } from "lucide-react";
import { SimpleDDAHeatmap } from "../../plot/SimpleDDAHeatmap";
import { Button } from "../../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { Badge } from "../../ui/badge";
import { useLoadingManager } from "../../../hooks/useLoadingManager";
import { LoadingOverlay } from "../../ui/loading-overlay";
import logger from "../../../lib/utils/logger";
import { usePopoutAuth } from "../../../hooks/usePopoutAuth";
import { useAppSelector, useAppDispatch } from "../../../store";
import { startLoading, stopLoading } from "../../../store/slices/loadingSlice";

interface DDAHeatmapWidgetProps {
  widgetId?: string;
  isPopout?: boolean;
}

export function DDAHeatmapWidget({
  widgetId = "dda-heatmap-widget-default",
  isPopout = false,
}: DDAHeatmapWidgetProps = {}) {
  console.log("[DDAHeatmapWidget] Component rendered with widgetId:", widgetId);

  // Use popout authentication hook
  const { isAuthenticated } = usePopoutAuth({
    widgetId,
    isPopout,
  });

  const {
    currentFilePath,
    currentPlotState,
    currentEdfData,
    currentChunkMetadata,
    selectFile,
    selectChannels,
  } = useCurrentEdfFile();

  const loadingManager = useLoadingManager();

  // Use currentPlotState only if it exists and has the required properties
  const plotWithDDA =
    currentPlotState &&
      currentPlotState.ddaResults &&
      Array.isArray(currentPlotState.ddaResults.Q) &&
      currentPlotState.ddaResults.Q.length > 0
      ? currentPlotState
      : null;

  // Use plotWithDDA directly as a PlotState or null
  const ddaResults = plotWithDDA?.ddaResults;
  const Q = ddaResults?.Q;
  const hasData = Q && Array.isArray(Q) && Q.length > 0;

  console.log("[DDAHeatmapWidget] DDA data check:", {
    currentFilePath,
    currentPlotState: !!currentPlotState,
    hasDdaResults: !!currentPlotState?.ddaResults,
    ddaResultsQ: currentPlotState?.ddaResults?.Q,
    plotWithDDA: !!plotWithDDA,
    Q: Q,
    hasData: hasData,
    QLength: Q?.length,
    QFirstRowLength: Q?.[0]?.length,
    // Check if file paths match
    storedFilePath: currentPlotState?.ddaResults?.file_path,
    pathMatch: currentFilePath === currentPlotState?.ddaResults?.file_path,
  });

  const hasPlottableData = useMemo(() => {
    if (!hasData || !Q) return false;
    return Q.some((row) => row.some((val) => val !== null));
  }, [Q, hasData]);

  // Use centralized loading state instead of local state
  const dispatch = useAppDispatch();
  const loadingState = useAppSelector((state) => state.loading);
  const widgetLoadingId = `heatmap-widget-${widgetId}`;
  const isProcessing = loadingState.operations[widgetLoadingId]?.type === "dda-processing";
  const [heatmapData, setHeatmapData] = useState<any[]>([]);
  const error = loadingState.operations[widgetLoadingId]?.metadata?.error || null;

  // Process Q matrix into heatmap data
  const processQMatrix = async (matrix: any[][]) => {
    if (!matrix || !Array.isArray(matrix) || matrix.length === 0) {
      return [];
    }

    try {
      dispatch(startLoading({
        id: widgetLoadingId,
        type: "dda-processing",
        message: `Processing ${matrix.length}×${matrix[0]?.length || 0} DDA heatmap...`,
        showGlobalOverlay: false,
        metadata: { widgetId }
      }));

      // Simulate processing time for visibility
      await new Promise((resolve) => setTimeout(resolve, 50)); // Shorter delay

      const points: any[] = [];
      console.log("[DDAHeatmapWidget] Processing matrix:", {
        rows: matrix.length,
        cols: matrix[0]?.length,
        firstRowSample: matrix[0]?.slice(0, 5),
        matrixType: typeof matrix,
        isArray: Array.isArray(matrix),
      });

      matrix.forEach((row, rowIndex) => {
        if (Array.isArray(row)) {
          row.forEach((value, colIndex) => {
            // Handle cases where the value might be wrapped in an array e.g. [0.123]
            const unwrappedValue = Array.isArray(value) ? value[0] : value;

            // Skip null or undefined values explicitly
            if (unwrappedValue === null || unwrappedValue === undefined) {
              return;
            }

            let numericValue = unwrappedValue;
            if (typeof numericValue === "string") {
              numericValue = parseFloat(numericValue);
            }

            if (typeof numericValue === "number" && !isNaN(numericValue)) {
              points.push({
                x: colIndex,
                y: rowIndex,
                value: numericValue,
              });
            }
          });
        }
      });

      console.log("[DDAHeatmapWidget] Processed points:", {
        totalPoints: points.length,
        samplePoints: points.slice(0, 5),
        valueRange:
          points.length > 0
            ? {
              min: Math.min(...points.map((p) => p.value)),
              max: Math.max(...points.map((p) => p.value)),
            }
            : null,
      });

      if (points.length === 0 && matrix.length > 0) {
        logger.warn(
          "Heatmap data is empty after processing. Check Q matrix content.",
          {
            matrixSample: matrix.slice(0, 2),
            matrixLength: matrix.length,
            firstRowLength: matrix[0]?.length,
          }
        );
      }

      dispatch(stopLoading(widgetLoadingId));
      return points;
    } catch (err) {
      dispatch(stopLoading(widgetLoadingId));
      dispatch(startLoading({
        id: widgetLoadingId,
        type: "dda-processing",
        message: "Error processing heatmap",
        showGlobalOverlay: false,
        metadata: {
          widgetId,
          error: err instanceof Error ? err.message : "Failed to process heatmap"
        }
      }));
      setTimeout(() => dispatch(stopLoading(widgetLoadingId)), 3000);
      return [];
    }
  };

  // Process data when Q matrix changes
  useEffect(() => {
    if (hasData && Q) {
      processQMatrix(Q).then(setHeatmapData);
    } else {
      setHeatmapData([]);
    }
  }, [Q, hasData]);

  const handleRefresh = () => {
    if (hasData && Q) {
      processQMatrix(Q).then(setHeatmapData);
    }
  };

  if (!hasData) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4" />
            DDA Heatmap
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No DDA results available</p>
            <p className="text-xs mt-1">Run DDA to see results</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!hasPlottableData) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4" />
            DDA Heatmap
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No plottable DDA data</p>
            <p className="text-xs mt-1">
              The analysis resulted in no valid data points.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4" />
            DDA Heatmap
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col items-center justify-center">
          <div className="text-center text-destructive">
            <p className="text-sm">Error processing heatmap</p>
            <p className="text-xs mt-1">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              className="mt-2"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col relative">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4" />
            DDA Heatmap
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {Q.length}×{Q[0]?.length || 0}
            </Badge>
            <Button variant="ghost" size="sm" onClick={handleRefresh}>
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0 relative overflow-hidden">
        {isProcessing && (
          <LoadingOverlay
            show={true}
            message="Processing DDA Heatmap..."
            type="dda-processing"
            variant="modal"
            size="lg"
          />
        )}

        {!isProcessing && heatmapData.length > 0 && (
          <div className="h-full w-full p-4 overflow-hidden">
            <SimpleDDAHeatmap
              data={heatmapData}
              width="100%"
              height="100%"
              channels={currentPlotState?.selectedChannels}
            />
          </div>
        )}

        {!isProcessing && heatmapData.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No heatmap data</p>
            </div>
          </div>
        )}
      </CardContent>

      {/* Info overlay */}
      {currentFilePath && !isProcessing && (
        <div className="absolute bottom-2 left-2 bg-background/80 backdrop-blur-sm rounded-md p-2 text-xs">
          <div className="font-medium">{currentFilePath.split("/").pop()}</div>
          <div className="text-muted-foreground">
            {heatmapData.length} data points
          </div>
        </div>
      )}
    </Card>
  );
}
