import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity, Download, RefreshCw } from "lucide-react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { dataPersistenceService } from "@/services/DataPersistenceService";

interface DDAHeatmapWidgetProps {
  widgetId?: string;
  isPopout?: boolean;
}

export function DDAHeatmapWidget({
  widgetId = "dda-heatmap-widget",
  isPopout = false,
}: DDAHeatmapWidgetProps) {
  const [Q, setQ] = useState<number[][]>([]);
  const [colorScheme, setColorScheme] = useState<
    "viridis" | "plasma" | "inferno" | "jet"
  >("viridis");
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const dataKeyRef = useRef<string | null>(null);

  // Persist/restore across unmounts (minimize/maximize)
  const storageKey = useMemo(
    () => `dda:heatmap-widget:v1:${widgetId}`,
    [widgetId]
  );
  const restoredRef = useRef(false);

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
      const rows = matrix.length;
      const cols = matrix[0]?.length || 0;

      console.log("[DDAHeatmapWidget] Processing matrix:", {
        rows,
        cols,
        totalPoints: rows * cols,
        firstRowSample: matrix[0]?.slice(0, 5),
        matrixType: typeof matrix,
        isArray: Array.isArray(matrix),
      });

      // Downsample large matrices for better performance and visualization
      const MAX_HEATMAP_POINTS = 10000; // Reasonable limit for visualization
      const totalPoints = rows * cols;
      let stepRow = 1;
      let stepCol = 1;

      if (totalPoints > MAX_HEATMAP_POINTS) {
        // Calculate downsampling steps
        const targetCols = Math.min(cols, 500); // Max 500 columns for visualization
        const targetRows = Math.min(rows, 20);  // Max 20 rows (channels)

        stepCol = Math.max(1, Math.floor(cols / targetCols));
        stepRow = Math.max(1, Math.floor(rows / targetRows));

        console.log("[DDAHeatmapWidget] Downsampling large matrix:", {
          original: `${rows}×${cols}`,
          target: `${Math.ceil(rows/stepRow)}×${Math.ceil(cols/stepCol)}`,
          stepRow,
          stepCol,
          originalPoints: totalPoints,
          targetPoints: Math.ceil(rows/stepRow) * Math.ceil(cols/stepCol)
        });
      }

      matrix.forEach((row, rowIndex) => {
        // Skip rows based on downsampling
        if (rowIndex % stepRow !== 0) return;

        if (Array.isArray(row)) {
          row.forEach((value, colIndex) => {
            // Skip columns based on downsampling
            if (colIndex % stepCol !== 0) return;

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
                x: Math.floor(colIndex / stepCol), // Use downsampled coordinates
                y: Math.floor(rowIndex / stepRow), // Use downsampled coordinates
                value: numericValue,
                originalX: colIndex, // Keep original coordinates for reference
                originalY: rowIndex,
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
            DDA Heatmap (a1 Coefficients)
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
            DDA Heatmap (a1 Coefficients)
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
            DDA Heatmap (a1 Coefficients)
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
            DDA Heatmap (a1 Coefficients)
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
