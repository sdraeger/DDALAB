import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useToast } from "./useToast";
import { useLoadingManager } from "./useLoadingManager";
import { cacheManager } from "../lib/utils/cache";
import logger from "../lib/utils/logger";
import type { HeatmapPoint } from "../components/plot/DDAHeatmap";

interface UseHeatmapDataProps {
  filePath?: string;
  Q?: any[][];
}

interface UseHeatmapDataReturn {
  ddaHeatmapData: HeatmapPoint[];
  showHeatmap: boolean;
  isHeatmapProcessing: boolean;
  setDdaHeatmapData: (data: HeatmapPoint[]) => void;
  setShowHeatmap: (show: boolean) => void;
  toggleHeatmap: () => void;
  processMatrixForHeatmap: (matrix: any[][]) => HeatmapPoint[];
}

export const useHeatmapData = ({
  filePath,
  Q,
}: UseHeatmapDataProps): UseHeatmapDataReturn => {
  const { toast } = useToast();
  const loadingManager = useLoadingManager();
  const [ddaHeatmapData, setDdaHeatmapData] = useState<HeatmapPoint[]>([]);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [isHeatmapProcessing, setIsHeatmapProcessing] = useState(false);
  const processingRef = useRef<boolean>(false);

  // Async matrix processing function to avoid blocking UI
  const processMatrixForHeatmapAsync = useCallback(
    (matrix: any[][]): Promise<HeatmapPoint[]> => {
      return new Promise((resolve) => {
        // Use requestAnimationFrame to ensure UI has chance to update
        requestAnimationFrame(() => {
          if (!matrix || !Array.isArray(matrix) || matrix.length === 0) {
            resolve([]);
            return;
          }

          const points: HeatmapPoint[] = [];
          let processedRows = 0;

          const processChunk = () => {
            const chunkSize = Math.min(10, matrix.length - processedRows); // Process 10 rows at a time
            const endRow = processedRows + chunkSize;

            for (let rowIndex = processedRows; rowIndex < endRow; rowIndex++) {
              const row = matrix[rowIndex];
              if (Array.isArray(row)) {
                row.forEach((value, colIndex) => {
                  if (typeof value === "number" && !isNaN(value)) {
                    points.push({
                      x: colIndex,
                      y: rowIndex,
                      value: value,
                    });
                  }
                });
              }
            }

            processedRows = endRow;

            if (processedRows < matrix.length) {
              // Continue processing in next frame
              requestAnimationFrame(processChunk);
            } else {
              // Finished processing
              resolve(points);
            }
          };

          processChunk();
        });
      });
    },
    []
  );

  // Sync version for backwards compatibility
  const processMatrixForHeatmap = useCallback(
    (matrix: any[][]): HeatmapPoint[] => {
      if (!matrix || !Array.isArray(matrix) || matrix.length === 0) {
        return [];
      }

      const points: HeatmapPoint[] = [];
      matrix.forEach((row, rowIndex) => {
        if (Array.isArray(row)) {
          row.forEach((value, colIndex) => {
            if (typeof value === "number" && !isNaN(value)) {
              points.push({
                x: colIndex,
                y: rowIndex,
                value: value,
              });
            }
          });
        }
      });
      return points;
    },
    []
  );

  // Create a stable cache key for Q matrix
  const qCacheKey = useMemo(() => {
    if (!Q || !Array.isArray(Q)) return null;
    return JSON.stringify({ rows: Q.length, cols: Q[0]?.length || 0 });
  }, [Q]);

  // Auto-process and show heatmap when Q matrix is available
  useEffect(() => {
    if (
      Q &&
      Array.isArray(Q) &&
      Q.length > 0 &&
      filePath &&
      !processingRef.current
    ) {
      console.log(
        `Starting heatmap processing for ${Q.length}×${
          Q[0]?.length || 0
        } matrix`
      );
      processingRef.current = true;

      // Set loading state immediately to show animation
      setIsHeatmapProcessing(true);

      // Start unified loading
      const loadingId = `heatmap-${filePath}`;
      const matrixRows = Q.length;
      const matrixCols = Q[0]?.length || 0;
      loadingManager.startDDAProcessing(
        loadingId,
        `Processing ${matrixRows}×${matrixCols} DDA heatmap...`
      );

      // Check cache first
      const heatmapCacheKey = { filePath, Q };
      const cachedHeatmap = cacheManager.getCachedHeatmapData(heatmapCacheKey);

      if (cachedHeatmap) {
        console.log("Using cached heatmap data");
        setDdaHeatmapData(cachedHeatmap);
        setShowHeatmap(true);
        setIsHeatmapProcessing(false);
        processingRef.current = false;

        // Stop loading since we're using cached data
        const loadingId = `heatmap-${filePath}`;
        loadingManager.stop(loadingId);
        return;
      }

      console.log("Processing new heatmap data...");

      // Process new data asynchronously
      const processData = async () => {
        try {
          // Add minimum delay to ensure loading animation is visible
          const [processedData] = await Promise.all([
            processMatrixForHeatmapAsync(Q),
            new Promise((resolve) => setTimeout(resolve, 500)), // Minimum 500ms to see animation
          ]);

          console.log(
            `Processing completed: ${processedData.length} data points`
          );
          setDdaHeatmapData(processedData);
          setShowHeatmap(true);

          // Cache the processed data
          cacheManager.cacheHeatmapData(heatmapCacheKey, processedData);
          logger.info("Cached heatmap data:", filePath);

          // Complete loading successfully
          const loadingId = `heatmap-${filePath}`;
          loadingManager.updateProgress(
            loadingId,
            100,
            "Heatmap generated successfully!"
          );
          setTimeout(() => loadingManager.stop(loadingId), 500);
        } catch (err) {
          console.error("Error processing heatmap data:", err);
          logger.error("Error processing heatmap data:", err);
          toast({
            title: "Heatmap Error",
            description: "Could not process data for the heatmap.",
            variant: "destructive",
          });
          setShowHeatmap(false);

          // Stop loading on error
          const loadingId = `heatmap-${filePath}`;
          loadingManager.stop(loadingId);
        } finally {
          setIsHeatmapProcessing(false);
          processingRef.current = false;
        }
      };

      processData();
    } else if (!Q || !Array.isArray(Q) || Q.length === 0) {
      // Hide heatmap when no Q matrix is available
      setShowHeatmap(false);
      setDdaHeatmapData([]);
      setIsHeatmapProcessing(false);
      processingRef.current = false;
    }
  }, [
    Q,
    filePath,
    qCacheKey,
    processMatrixForHeatmapAsync,
    toast,
    loadingManager,
  ]);

  const toggleHeatmap = useCallback(() => {
    if (!showHeatmap && Q && filePath) {
      // Check cache first
      const heatmapCacheKey = { filePath, Q };
      const cachedHeatmap = cacheManager.getCachedHeatmapData(heatmapCacheKey);

      if (cachedHeatmap) {
        logger.info("Using cached heatmap data:", filePath);
        setDdaHeatmapData(cachedHeatmap);
        setShowHeatmap(true);
        return;
      }

      // Process asynchronously
      setIsHeatmapProcessing(true);

      // Start unified loading
      const loadingId = `heatmap-toggle-${filePath}`;
      const matrixRows = Q.length;
      const matrixCols = Q[0]?.length || 0;
      loadingManager.startDDAProcessing(
        loadingId,
        `Processing ${matrixRows}×${matrixCols} DDA heatmap...`
      );

      const processData = async () => {
        try {
          const processedData = await processMatrixForHeatmapAsync(Q);
          setDdaHeatmapData(processedData);
          setShowHeatmap(true);

          // Cache the processed data
          cacheManager.cacheHeatmapData(heatmapCacheKey, processedData);
          logger.info("Cached heatmap data:", filePath);

          // Complete loading successfully
          loadingManager.updateProgress(
            loadingId,
            100,
            "Heatmap generated successfully!"
          );
          setTimeout(() => loadingManager.stop(loadingId), 500);
        } catch (err) {
          logger.error("Error processing heatmap data:", err);
          toast({
            title: "Heatmap Error",
            description: "Could not process data for the heatmap.",
            variant: "destructive",
          });
          setShowHeatmap(false);

          // Stop loading on error
          loadingManager.stop(loadingId);
        } finally {
          setIsHeatmapProcessing(false);
        }
      };

      processData();
    } else {
      setShowHeatmap(!showHeatmap);
    }
  }, [
    showHeatmap,
    Q,
    filePath,
    processMatrixForHeatmapAsync,
    toast,
    loadingManager,
  ]);

  return {
    ddaHeatmapData,
    showHeatmap,
    isHeatmapProcessing,
    setDdaHeatmapData,
    setShowHeatmap,
    toggleHeatmap,
    processMatrixForHeatmap,
  };
};
