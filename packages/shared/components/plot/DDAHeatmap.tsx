"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Button } from "../ui/button";
import { Loader2 } from "lucide-react";

export interface HeatmapPoint {
  x: number;
  y: number;
  value: number;
  isFillValue?: boolean;
}

interface DDAHeatmapProps {
  data: HeatmapPoint[];
  width?: number;
  height?: number;
  channels?: string[];
  onClose?: () => void;
  dataColumnStart?: number; // Start column index for focused color scaling
  dataColumnEnd?: number; // End column index for focused color scaling
  nullValueColor?: string; // Optional: color for null values
  percentileLow?: number; // Optional: lower percentile for color scaling (default 5)
  percentileHigh?: number; // Optional: upper percentile for color scaling (default 95)
}

// Default values
const DEFAULT_ZOOM = 1;
const DEFAULT_PAN = { x: 0, y: 0 };
const MAX_ZOOM_LEVEL = 100;
const MIN_INITIAL_ZOOM_FACTOR = 0.1;
const DEFAULT_NULL_COLOR = "rgb(220, 220, 220)";
const DEFAULT_PERCENTILE_LOW = 2; // Changed from 5 to 2 for better range
const DEFAULT_PERCENTILE_HIGH = 98; // Changed from 95 to 98 for better range

export function DDAHeatmap({
  data,
  width = 800,
  height = 600,
  channels,
  onClose,
  dataColumnStart,
  dataColumnEnd,
  nullValueColor = DEFAULT_NULL_COLOR,
  percentileLow = DEFAULT_PERCENTILE_LOW,
  percentileHigh = DEFAULT_PERCENTILE_HIGH,
}: DDAHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heatmapContainerRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef<boolean>(false);
  const cancelDrawingRef = useRef<boolean>(false);

  // State for dynamic canvas dimensions
  const [currentCanvasWidth, setCurrentCanvasWidth] = useState(width);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [pan, setPan] = useState<{ x: number; y: number }>(DEFAULT_PAN);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dynamicMinZoom, setDynamicMinZoom] = useState(0.1);
  const [isRendering, setIsRendering] = useState(false);
  const initialViewCalculated = useRef(false);
  
  // Cursor tracking state
  const [cursorInfo, setCursorInfo] = useState<{
    x: number;
    y: number;
    dataX: number;
    dataY: number;
    value: number | null;
    visible: boolean;
  } | null>(null);

  // Memoized data processing
  const { dataExtents, colorRange, gridData, statistics } = useMemo(() => {
    if (data.length === 0) {
      return {
        dataExtents: { minX: 0, maxX: 0, minY: 0, maxY: 0, numX: 1, numY: 1 },
        colorRange: [0, 1] as [number, number],
        gridData: new Map<string, number>(),
        statistics: { mean: 0, std: 0, validCount: 0 }
      };
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const pointValuesForColorScale: number[] = [];
    const gridMap = new Map<string, number>();
    let sum = 0;
    let validCount = 0;

    // First pass: collect data and statistics
    for (const point of data) {
      if (typeof point?.x === "number" && !isNaN(point.x)) {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
      }
      if (typeof point?.y === "number" && !isNaN(point.y)) {
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
      }

      // Store in grid for fast lookup
      gridMap.set(`${point.x},${point.y}`, point.value);

      // Collect values for color scaling, excluding fill values and NaN
      if (
        !point.isFillValue &&
        typeof point?.value === "number" &&
        !isNaN(point.value) &&
        isFinite(point.value) &&
        (dataColumnStart === undefined || point.x >= dataColumnStart) &&
        (dataColumnEnd === undefined || point.x <= dataColumnEnd)
      ) {
        pointValuesForColorScale.push(point.value);
        sum += point.value;
        validCount++;
      }
    }

    // Calculate statistics
    const mean = validCount > 0 ? sum / validCount : 0;
    let variance = 0;
    if (validCount > 1) {
      for (const value of pointValuesForColorScale) {
        variance += Math.pow(value - mean, 2);
      }
      variance /= (validCount - 1);
    }
    const std = Math.sqrt(variance);

    // Calculate color range using percentiles or robust statistics
    let effectiveMinVal = 0;
    let effectiveMaxVal = 1;
    
    if (pointValuesForColorScale.length > 0) {
      pointValuesForColorScale.sort((a, b) => a - b);
      
      // Use percentiles if we have enough data
      if (pointValuesForColorScale.length > 20) {
        const lowIndex = Math.floor(pointValuesForColorScale.length * percentileLow / 100);
        const highIndex = Math.ceil(pointValuesForColorScale.length * percentileHigh / 100) - 1;
        
        effectiveMinVal = pointValuesForColorScale[Math.max(0, lowIndex)];
        effectiveMaxVal = pointValuesForColorScale[Math.min(pointValuesForColorScale.length - 1, highIndex)];
      } else {
        // For small datasets, use min/max
        effectiveMinVal = pointValuesForColorScale[0];
        effectiveMaxVal = pointValuesForColorScale[pointValuesForColorScale.length - 1];
      }

      // Ensure we have a valid range
      if (effectiveMaxVal <= effectiveMinVal) {
        // If all values are the same, create a small range around that value
        const midValue = effectiveMinVal;
        effectiveMinVal = midValue - 0.5;
        effectiveMaxVal = midValue + 0.5;
      }
      
      // Log the color range for debugging
      console.log('Color range calculation:', {
        validCount,
        mean: mean.toFixed(3),
        std: std.toFixed(3),
        minValue: Math.min(...pointValuesForColorScale).toFixed(3),
        maxValue: Math.max(...pointValuesForColorScale).toFixed(3),
        effectiveMin: effectiveMinVal.toFixed(3),
        effectiveMax: effectiveMaxVal.toFixed(3),
        percentiles: [percentileLow, percentileHigh]
      });
    }

    minX = isFinite(minX) ? minX : 0;
    maxX = isFinite(maxX) ? maxX : width;
    if (maxX <= minX) maxX = minX + 1;

    minY = isFinite(minY) ? minY : 0;
    maxY = isFinite(maxY) ? maxY : height;
    if (maxY <= minY) maxY = minY + 1;

    return {
      dataExtents: {
        minX,
        maxX,
        minY,
        maxY,
        numX: maxX - minX + 1,
        numY: maxY - minY + 1,
      },
      colorRange: [effectiveMinVal, effectiveMaxVal] as [number, number],
      gridData: gridMap,
      statistics: { mean, std, validCount }
    };
  }, [data, currentCanvasWidth, height, dataColumnStart, dataColumnEnd, percentileLow, percentileHigh]);

  // Initialize view when data changes
  useEffect(() => {
    if (data.length === 0) {
      initialViewCalculated.current = false;
      setZoom(DEFAULT_ZOOM);
      setPan(DEFAULT_PAN);
      return;
    }

    if (!initialViewCalculated.current) {
      console.log('Initializing view with dataExtents:', dataExtents);

      const dataWidth = dataExtents.maxX - dataExtents.minX;
      const dataHeight = dataExtents.maxY - dataExtents.minY;

      console.log('Data dimensions:', { dataWidth, dataHeight });

      // Simple zoom calculation that ensures we see all the data
      const zoomX = dataWidth > 0 ? currentCanvasWidth / (dataWidth * 1.2) : 1; // Add 20% padding
      const zoomY = dataHeight > 0 ? height / (dataHeight * 1.2) : 1; // Add 20% padding

      // Use minimum to ensure all data fits
      const newInitialZoom = Math.min(zoomX, zoomY);

      console.log('Zoom calculation:', { zoomX, zoomY, newInitialZoom });

      // Center the view on the data
      const dataCenterX = (dataExtents.minX + dataExtents.maxX) / 2;
      const dataCenterY = (dataExtents.minY + dataExtents.maxY) / 2;

      // Calculate pan to center the data with better alignment
      const newInitialPanX = dataExtents.minX - (currentCanvasWidth / newInitialZoom - dataWidth) / 2;
      const newInitialPanY = dataExtents.minY - (height / newInitialZoom - dataHeight) / 2;

      console.log('Pan calculation:', { dataCenterX, dataCenterY, newInitialPanX, newInitialPanY });

      setZoom(newInitialZoom);
      setPan({ x: newInitialPanX, y: newInitialPanY });
      setDynamicMinZoom(Math.max(0.01, newInitialZoom * MIN_INITIAL_ZOOM_FACTOR));
      initialViewCalculated.current = true;
    }
  }, [data, dataExtents, currentCanvasWidth, height]);

  // Improved color mapping function (inferno colormap)
  const intToInfernoRGB = useCallback((value: number): [number, number, number] => {
    if (isNaN(value) || !isFinite(value)) return [0, 0, 0];

    const normalized = Math.min(Math.max(value, 0), 1);

    const infernoControlPoints: { scalar: number; rgb: [number, number, number] }[] = [
      { scalar: 0.0, rgb: [0, 0, 4] },
      { scalar: 0.2, rgb: [20, 11, 52] },
      { scalar: 0.4, rgb: [66, 10, 104] },
      { scalar: 0.6, rgb: [147, 38, 103] },
      { scalar: 0.8, rgb: [229, 92, 48] },
      { scalar: 1.0, rgb: [252, 255, 164] },
    ];

    for (let i = 0; i < infernoControlPoints.length - 1; i++) {
      const point1 = infernoControlPoints[i];
      const point2 = infernoControlPoints[i + 1];

      if (normalized >= point1.scalar && normalized <= point2.scalar) {
        const t = (normalized - point1.scalar) / (point2.scalar - point1.scalar);
        return [
          Math.round(point1.rgb[0] + (point2.rgb[0] - point1.rgb[0]) * t),
          Math.round(point1.rgb[1] + (point2.rgb[1] - point1.rgb[1]) * t),
          Math.round(point1.rgb[2] + (point2.rgb[2] - point1.rgb[2]) * t),
        ];
      }
    }

    return infernoControlPoints[infernoControlPoints.length - 1].rgb;
  }, []);

  // Optimized drawing using ImageData for pixel-perfect rendering like matplotlib
  const drawHeatmap = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || drawingRef.current) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawingRef.current = true;
    cancelDrawingRef.current = false;
    setIsRendering(true);

    try {
      // Clear canvas first
      ctx.clearRect(0, 0, currentCanvasWidth, height);

      if (data.length === 0) {
        setIsRendering(false);
        drawingRef.current = false;
        return;
      }

      console.log('Starting async heatmap drawing:', {
        dataLength: data.length,
        dataExtents,
        zoom,
        pan,
        colorRange,
        canvasSize: { width: currentCanvasWidth, height },
        statistics
      });

      // Create ImageData for pixel-perfect rendering
      const imageData = ctx.createImageData(currentCanvasWidth, height);
      const pixels = imageData.data;

      const [minValue, maxValue] = colorRange;
      const valueRange = maxValue - minValue === 0 ? 1 : maxValue - minValue;

      // Calculate visible region
      const visibleMinX = pan.x;
      const visibleMaxX = pan.x + currentCanvasWidth / zoom;
      const visibleMinY = pan.y;
      const visibleMaxY = pan.y + height / zoom;

      console.log('Visible region:', { visibleMinX, visibleMaxX, visibleMinY, visibleMaxY });
      console.log('Data extents:', dataExtents);
      console.log('Zoom and pan:', { zoom, pan });

      // Pre-fill with background color (darker gray for better contrast)
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 30;      // Darker gray
        pixels[i + 1] = 30;
        pixels[i + 2] = 30;
        pixels[i + 3] = 255;
      }

      // Process in chunks to avoid blocking UI
      const CHUNK_SIZE = Math.min(height / 10, 50); // Process 50 rows at a time
      let rowsProcessed = 0;

      const processChunk = async (): Promise<void> => {
        return new Promise((resolve) => {
          requestAnimationFrame(() => {
            if (cancelDrawingRef.current) {
              resolve();
              return;
            }

            const startRow = rowsProcessed;
            const endRow = Math.min(rowsProcessed + CHUNK_SIZE, height);

            // Process chunk of rows
            for (let canvasY = startRow; canvasY < endRow; canvasY++) {
              if (cancelDrawingRef.current) break;

              for (let canvasX = 0; canvasX < currentCanvasWidth; canvasX++) {
                // Map canvas coordinates to data coordinates
                const dataX = visibleMinX + (canvasX / currentCanvasWidth) * (visibleMaxX - visibleMinX);
                const dataY = visibleMinY + (canvasY / height) * (visibleMaxY - visibleMinY);

                // Find data point efficiently
                const exactX = Math.round(dataX);
                const exactY = Math.round(dataY);
                const value = gridData.get(`${exactX},${exactY}`);

                if (value !== undefined && !isNaN(value) && isFinite(value)) {
                  // Add some debugging for the first few pixels
                  if (canvasX < 5 && canvasY < 5) {
                    console.log(`Pixel (${canvasX},${canvasY}) -> Data (${exactX},${exactY}) = ${value}`);
                  }
                  const pixelIndex = (canvasY * currentCanvasWidth + canvasX) * 4;
                  
                  // Clamp value to color range to avoid overflow
                  const clampedValue = Math.max(minValue, Math.min(maxValue, value));
                  const normalizedValue = (clampedValue - minValue) / valueRange;
                  const [r, g, b] = intToInfernoRGB(normalizedValue);

                  pixels[pixelIndex] = r;     // Red
                  pixels[pixelIndex + 1] = g; // Green
                  pixels[pixelIndex + 2] = b; // Blue
                  pixels[pixelIndex + 3] = 255; // Alpha
                }
              }
            }

            rowsProcessed = endRow;
            resolve();
          });
        });
      };

      // Process all chunks
      while (rowsProcessed < height && !cancelDrawingRef.current) {
        await processChunk();

        // Update progress periodically
        if (rowsProcessed % (CHUNK_SIZE * 5) === 0) {
          console.log(`Rendering progress: ${Math.round((rowsProcessed / height) * 100)}%`);
        }
      }

      if (!cancelDrawingRef.current) {
        // Draw the final image
        ctx.putImageData(imageData, 0, 0);

        // Draw channel names
        if (channels && channels.length > 0) {
          ctx.fillStyle = "white";
          ctx.strokeStyle = "black";
          ctx.lineWidth = 2;
          ctx.font = "bold 12px Arial";

          const channelHeight = (dataExtents.maxY - dataExtents.minY) / channels.length;
          const dataRangeY = visibleMaxY - visibleMinY;

          channels.forEach((channelName, index) => {
            const dataChannelY = dataExtents.minY + (index + 0.5) * channelHeight;
            const screenY = ((dataChannelY - visibleMinY) / dataRangeY) * height;

            if (screenY >= 0 && screenY <= height) {
              ctx.strokeText(channelName, 8, screenY);
              ctx.fillText(channelName, 8, screenY);
            }
          });
        }

        // Draw color scale info in corner
        ctx.fillStyle = "white";
        ctx.strokeStyle = "black";
        ctx.lineWidth = 1;
        ctx.font = "10px Arial";
        const rangeText = `Range: [${colorRange[0].toFixed(2)}, ${colorRange[1].toFixed(2)}]`;
        const statsText = `μ=${statistics.mean.toFixed(2)}, σ=${statistics.std.toFixed(2)}`;
        ctx.strokeText(rangeText, currentCanvasWidth - 150, 20);
        ctx.fillText(rangeText, currentCanvasWidth - 150, 20);
        ctx.strokeText(statsText, currentCanvasWidth - 150, 35);
        ctx.fillText(statsText, currentCanvasWidth - 150, 35);

        console.log('Heatmap drawing completed successfully');
      }
    } catch (error) {
      console.error('Error during heatmap drawing:', error);
    } finally {
      setIsRendering(false);
      drawingRef.current = false;
    }
  }, [data, zoom, pan, currentCanvasWidth, height, colorRange, gridData, channels, intToInfernoRGB, dataExtents, statistics]);

  // Debounced redraw
  useEffect(() => {
    // Cancel any ongoing drawing
    cancelDrawingRef.current = true;

    const timeoutId = setTimeout(() => {
      drawHeatmap();
    }, 16); // ~60fps for smoother interactions

    return () => {
      clearTimeout(timeoutId);
      cancelDrawingRef.current = true;
    };
  }, [drawHeatmap]);

  // Interaction handlers
  const handleWheel = useCallback((e: globalThis.WheelEvent) => {
    if (!e.metaKey && !e.ctrlKey) return;
    if (isRendering) return; // Prevent zooming during rendering

    e.preventDefault();
    e.stopPropagation();

    const delta = -e.deltaY;
    const scale = delta > 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(Math.max(zoom * scale, dynamicMinZoom), MAX_ZOOM_LEVEL);

    const targetCanvas = e.currentTarget as HTMLCanvasElement;
    if (!targetCanvas) return;

    const rect = targetCanvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldXBefore = pan.x + mouseX / zoom;
    const worldYBefore = pan.y + mouseY / zoom;
    const newPanX = worldXBefore - mouseX / newZoom;
    const newPanY = worldYBefore - mouseY / newZoom;

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [zoom, pan, dynamicMinZoom, isRendering]);

  // Attach wheel event listener
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const wheelListener = (event: globalThis.WheelEvent) => handleWheel(event);
    canvas.addEventListener("wheel", wheelListener, { passive: false });

    return () => canvas.removeEventListener("wheel", wheelListener);
  }, [handleWheel]);

  // Mouse interaction handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || isRendering) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    (e.target as HTMLElement).style.cursor = "grabbing";
  }, [isRendering]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isRendering) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    if (isDragging) {
      // Handle dragging
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;

      setPan(prevPan => ({
        x: prevPan.x - dx / zoom,
        y: prevPan.y - dy / zoom,
      }));

      setDragStart({ x: e.clientX, y: e.clientY });
    } else {
      // Handle cursor tracking
      const visibleMinX = pan.x;
      const visibleMaxX = pan.x + currentCanvasWidth / zoom;
      const visibleMinY = pan.y;
      const visibleMaxY = pan.y + height / zoom;

      // Map canvas coordinates to data coordinates
      const dataX = visibleMinX + (canvasX / currentCanvasWidth) * (visibleMaxX - visibleMinX);
      const dataY = visibleMinY + (canvasY / height) * (visibleMaxY - visibleMinY);

      // Find the nearest data point
      const exactX = Math.round(dataX);
      const exactY = Math.round(dataY);
      const value = gridData.get(`${exactX},${exactY}`);

      setCursorInfo({
        x: canvasX,
        y: canvasY,
        dataX: exactX,
        dataY: exactY,
        value: value ?? null,
        visible: true,
      });
    }
  }, [isDragging, dragStart, zoom, isRendering, pan, currentCanvasWidth, height, gridData]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setIsDragging(false);
      (e.target as HTMLElement).style.cursor = "grab";
    }
  }, [isDragging]);

  const handleMouseLeave = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setIsDragging(false);
      (e.target as HTMLElement).style.cursor = "grab";
    }
    
    // Hide cursor info when mouse leaves the heatmap
    setCursorInfo(null);
  }, [isDragging]);

  const resetView = useCallback(() => {
    if (data.length > 0) {
      const dataWidth = dataExtents.maxX - dataExtents.minX;
      const dataHeight = dataExtents.maxY - dataExtents.minY;

      // Use the same simplified zoom calculation
      const zoomX = dataWidth > 0 ? currentCanvasWidth / (dataWidth * 1.2) : 1;
      const zoomY = dataHeight > 0 ? height / (dataHeight * 1.2) : 1;
      const initialZoom = Math.min(zoomX, zoomY);

      const dataCenterX = (dataExtents.minX + dataExtents.maxX) / 2;
      const dataCenterY = (dataExtents.minY + dataExtents.maxY) / 2;

      const initialPanX = dataExtents.minX - (currentCanvasWidth / initialZoom - dataWidth) / 2;
      const initialPanY = dataExtents.minY - (height / initialZoom - dataHeight) / 2;

      setZoom(initialZoom);
      setPan({ x: initialPanX, y: initialPanY });
      setDynamicMinZoom(Math.max(0.01, initialZoom * MIN_INITIAL_ZOOM_FACTOR));
      initialViewCalculated.current = true;
    } else {
      setZoom(DEFAULT_ZOOM);
      setPan(DEFAULT_PAN);
      setDynamicMinZoom(0.1);
      initialViewCalculated.current = false;
    }
  }, [data, dataExtents, currentCanvasWidth, height]);

  // Helper for safe number formatting
  const formatNumber = (num: number | undefined | null, fixed = 0): string => {
    if (typeof num !== "number" || isNaN(num)) return "...";
    return num.toFixed(fixed);
  };

  const formatZoom = (num: number | undefined | null, fixed = 2): string => {
    if (typeof num !== "number" || isNaN(num)) return "...";
    return num.toFixed(fixed);
  };

  // Debounced resize observer
  useEffect(() => {
    const containerElement = heatmapContainerRef.current;
    if (!containerElement) return;

    setCurrentCanvasWidth(containerElement.offsetWidth);

    let timeoutId: NodeJS.Timeout;
    const observer = new ResizeObserver((entries) => {
      if (!entries || !entries.length) return;

      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const newWidth = entries[0].contentRect.width;
        if (heatmapContainerRef.current && heatmapContainerRef.current.offsetWidth === newWidth) {
          setCurrentCanvasWidth(newWidth);
        }
      }, 100);
    });

    observer.observe(containerElement);

    return () => {
      clearTimeout(timeoutId);
      observer.unobserve(containerElement);
    };
  }, []);

  return (
    <div className="space-y-4 animate-in fade-in-50 duration-700 relative">
      {/* Rendering overlay */}
      {isRendering && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-md">
          <div className="flex flex-col items-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            <div className="text-center">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Rendering Heatmap
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {data.length.toLocaleString()} data points
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-between items-center gap-2">
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" onClick={resetView}>
            Reset View
          </Button>
          <span className="text-sm tabular-nums whitespace-nowrap">
            Zoom: {formatZoom(zoom)}x | Pan: ({formatNumber(pan?.x)}, {formatNumber(pan?.y)})
          </span>
        </div>
        <div className="text-sm whitespace-nowrap">
          Data: {data.length} points | Size: {dataExtents.numX}×{dataExtents.numY} | Range: X({dataExtents.minX}-{dataExtents.maxX}) Y({dataExtents.minY}-{dataExtents.maxY})
        </div>
      </div>

      <div
        ref={heatmapContainerRef}
        className="border rounded-md overflow-hidden relative bg-background cursor-grab w-full"
        style={{ height }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <canvas
          ref={canvasRef}
          width={currentCanvasWidth}
          height={height}
          className="block"
        />
        {/* Cursor info overlay */}
        {cursorInfo && cursorInfo.visible && (
          <div 
            className="absolute pointer-events-none z-20 bg-black/80 text-white px-2 py-1 rounded text-xs whitespace-nowrap"
            style={{
              left: Math.min(cursorInfo.x + 10, currentCanvasWidth - 120),
              top: Math.max(cursorInfo.y - 30, 10),
            }}
          >
            <div>X: {cursorInfo.dataX}, Y: {cursorInfo.dataY}</div>
            <div>Q: {cursorInfo.value !== null ? cursorInfo.value.toFixed(4) : 'N/A'}</div>
          </div>
        )}
        
        <div className="absolute top-3 right-3 flex flex-col space-y-2 z-10">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom(prev => Math.min(prev * 1.1, MAX_ZOOM_LEVEL))}
            className="w-8 h-8 p-0"
            aria-label="Zoom In"
            disabled={isRendering}
          >
            +
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom(prev => Math.max(prev / 1.1, dynamicMinZoom))}
            className="w-8 h-8 p-0"
            aria-label="Zoom Out"
            disabled={isRendering}
          >
            -
          </Button>
        </div>
      </div>
    </div>
  );
}