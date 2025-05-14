"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "../ui/button";

export interface HeatmapPoint {
  x: number;
  y: number;
  value: number;
  isFillValue?: boolean; // Added to mark null/fill values
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
}

// Default values
const DEFAULT_ZOOM = 1;
const DEFAULT_PAN = { x: 0, y: 0 };
const MAX_ZOOM_LEVEL = 500; // Max zoom out
const MIN_INITIAL_ZOOM_FACTOR = 0.25; // User can zoom out to 25% of the initial fitted view
const DEFAULT_NULL_COLOR = "rgb(220, 220, 220)"; // Light grey for nulls

export function DDAHeatmap({
  data,
  width = 800,
  height = 600,
  channels,
  onClose,
  dataColumnStart, // New prop
  dataColumnEnd, // New prop
  nullValueColor = DEFAULT_NULL_COLOR, // New prop with default
}: DDAHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heatmapContainerRef = useRef<HTMLDivElement>(null);

  // State for dynamic canvas dimensions
  const [currentCanvasWidth, setCurrentCanvasWidth] = useState(width);

  // Ensure state has valid initial values
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [pan, setPan] = useState<{ x: number; y: number }>(DEFAULT_PAN);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [colorRange, setColorRange] = useState<[number, number]>([0, 1]);
  const [dynamicMinZoom, setDynamicMinZoom] = useState(0.1); // Initial sensible minimum zoom
  const initialViewCalculated = useRef(false);
  const dataExtentsRef = useRef({
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    numX: 1,
    numY: 1,
  }); // Added for overall data dimensions

  // Effect 1: Calculate data bounds, initial view setting, and color range
  useEffect(() => {
    if (data.length === 0) {
      initialViewCalculated.current = false;
      setZoom(DEFAULT_ZOOM);
      setPan(DEFAULT_PAN);
      setColorRange([0, 1]);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, currentCanvasWidth, height);
      return;
    }

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    const pointValuesForColorScale: number[] = [];

    for (const point of data) {
      if (typeof point?.x === "number" && !isNaN(point.x)) {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
      }
      if (typeof point?.y === "number" && !isNaN(point.y)) {
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
      }

      if (
        !point.isFillValue &&
        typeof point?.value === "number" &&
        !isNaN(point.value) &&
        (dataColumnStart === undefined || point.x >= dataColumnStart) &&
        (dataColumnEnd === undefined || point.x <= dataColumnEnd)
      ) {
        pointValuesForColorScale.push(point.value);
      }
    }

    // Calculate color range using percentiles
    let effectiveMinVal = 0;
    let effectiveMaxVal = 1;
    if (pointValuesForColorScale.length > 0) {
      pointValuesForColorScale.sort((a, b) => a - b);
      const p5Index = Math.floor(pointValuesForColorScale.length * 0.05);
      const p95Index = Math.ceil(pointValuesForColorScale.length * 0.95) - 1;

      effectiveMinVal = pointValuesForColorScale[p5Index];
      effectiveMaxVal = pointValuesForColorScale[p95Index];

      if (pointValuesForColorScale.length < 2) {
        // Handle very few points
        effectiveMinVal = pointValuesForColorScale[0];
        effectiveMaxVal = pointValuesForColorScale[0] + 1;
      }

      if (effectiveMinVal === undefined || isNaN(effectiveMinVal))
        effectiveMinVal = 0;
      if (effectiveMaxVal === undefined || isNaN(effectiveMaxVal))
        effectiveMaxVal = effectiveMinVal + 1;

      if (effectiveMaxVal <= effectiveMinVal) {
        // Attempt to use absolute min/max if percentiles are problematic
        const absMin = pointValuesForColorScale[0];
        const absMax =
          pointValuesForColorScale[pointValuesForColorScale.length - 1];
        if (absMax > absMin) {
          effectiveMinVal = absMin;
          effectiveMaxVal = absMax;
        } else {
          effectiveMaxVal = effectiveMinVal + 1; // Fallback
        }
      }
    }
    setColorRange([effectiveMinVal, effectiveMaxVal]);

    minX = isFinite(minX) ? minX : 0;
    maxX = isFinite(maxX) ? maxX : width;
    if (maxX <= minX) maxX = minX + 1;

    minY = isFinite(minY) ? minY : 0;
    maxY = isFinite(maxY) ? maxY : height;
    if (maxY <= minY) maxY = minY + 1;

    dataExtentsRef.current = {
      minX: minX,
      maxX: maxX,
      minY: minY,
      maxY: maxY,
      numX: maxX - minX + 1, // Assuming contiguous data for numX
      numY: maxY - minY + 1, // Assuming contiguous data for numY
    };

    if (!initialViewCalculated.current) {
      const dataWidth =
        dataExtentsRef.current.maxX - dataExtentsRef.current.minX;
      const dataHeight =
        dataExtentsRef.current.maxY - dataExtentsRef.current.minY;

      const zoomX = dataWidth > 0 ? currentCanvasWidth / dataWidth : 1;
      const zoomY = dataHeight > 0 ? height / dataHeight : 1;
      let newInitialZoom = Math.min(zoomX, zoomY) * 0.9;
      newInitialZoom = Math.max(0.001, Math.min(newInitialZoom, 10));

      const dataCenterX = dataExtentsRef.current.minX + dataWidth / 2;
      const dataCenterY = dataExtentsRef.current.minY + dataHeight / 2;

      const newInitialPanX =
        dataCenterX - currentCanvasWidth / (2 * newInitialZoom);
      const newInitialPanY = dataCenterY - height / (2 * newInitialZoom);

      setZoom(newInitialZoom);
      setPan({ x: newInitialPanX, y: newInitialPanY });
      setDynamicMinZoom(
        Math.max(0.01, newInitialZoom * MIN_INITIAL_ZOOM_FACTOR)
      );
      initialViewCalculated.current = true;
    }
  }, [
    data,
    currentCanvasWidth,
    height,
    dataColumnStart,
    dataColumnEnd,
    initialViewCalculated,
  ]); // Added dataColumnStart/End

  function intToInfernoRGB(value: number): [number, number, number] {
    // Validate input
    if (isNaN(value)) {
      console.warn(`Invalid value: ${value}`);
      return [0, 0, 0]; // Fallback to black
    }

    // Clamp to [0, 1] since value is already normalized
    const normalized = Math.min(Math.max(value, 0), 1);

    // Inferno control points (scalar: [0, 1], rgb: [0-255])
    const infernoControlPoints: {
      scalar: number;
      rgb: [number, number, number];
    }[] = [
      { scalar: 0.0, rgb: [0, 0, 4] }, // Black
      { scalar: 0.2, rgb: [20, 11, 52] }, // Dark purple
      { scalar: 0.4, rgb: [66, 10, 104] }, // Purple
      { scalar: 0.6, rgb: [147, 38, 103] }, // Magenta
      { scalar: 0.8, rgb: [229, 92, 48] }, // Orange
      { scalar: 1.0, rgb: [252, 255, 164] }, // Yellow
    ];

    // Linear interpolation
    for (let i = 0; i < infernoControlPoints.length - 1; i++) {
      const point1 = infernoControlPoints[i];
      const point2 = infernoControlPoints[i + 1];

      if (normalized >= point1.scalar && normalized <= point2.scalar) {
        const t =
          (normalized - point1.scalar) / (point2.scalar - point1.scalar);
        return [
          Math.round(point1.rgb[0] + (point2.rgb[0] - point1.rgb[0]) * t),
          Math.round(point1.rgb[1] + (point2.rgb[1] - point1.rgb[1]) * t),
          Math.round(point1.rgb[2] + (point2.rgb[2] - point1.rgb[2]) * t),
        ];
      }
    }

    // Return last color if normalized == 1
    return infernoControlPoints[infernoControlPoints.length - 1].rgb;
  }

  // Effect 2: Drawing logic, depends on state variables set by Effect 1 and interactions
  const drawHeatmap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const currentZoom = zoom;
    const currentPan = pan;
    const currentData = data;
    const currentColorRange = colorRange;
    const { minX: dataMinXActual, numX: numXActualPoints } =
      dataExtentsRef.current;

    ctx.clearRect(0, 0, currentCanvasWidth, height);

    if (currentData.length === 0) return;

    // visibleX/Y/Width/Height are for Y-axis panning/zooming and coarse X culling
    const visibleWidth = currentCanvasWidth / currentZoom;
    const visibleHeight = height / currentZoom;
    const visibleX = currentPan.x;
    const visibleY = currentPan.y;

    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = currentCanvasWidth;
    offscreenCanvas.height = height;
    const offscreenCtx = offscreenCanvas.getContext("2d", { alpha: false });
    if (!offscreenCtx) return;

    const [minValue, maxValue] = currentColorRange;
    const valueRange = maxValue - minValue === 0 ? 1 : maxValue - minValue;

    // Hybrid drawing: X is stretched, Y uses pan/zoom
    const cellRenderWidth =
      numXActualPoints > 0
        ? currentCanvasWidth / numXActualPoints
        : currentCanvasWidth;
    const cellRenderHeight = Math.max(1, currentZoom);

    for (const point of currentData) {
      if (
        point.y < visibleY ||
        point.y > visibleY + visibleHeight ||
        point.x < dataExtentsRef.current.minX || // Cull X outside actual data range
        point.x > dataExtentsRef.current.maxX || // Cull X outside actual data range
        (typeof point.value !== "number" && !point.isFillValue) ||
        (isNaN(point.value) && !point.isFillValue)
      ) {
        continue;
      }

      // X position is scaled to fit the canvas width
      const finalScreenX = (point.x - dataMinXActual) * cellRenderWidth;
      // Y position uses the pan/zoom state
      const finalScreenY = (point.y - visibleY) * currentZoom;

      let color: string;
      if (point.isFillValue) {
        color = nullValueColor;
      } else {
        const normalizedValue = (point.value - minValue) / valueRange;
        const [r, g, b] = intToInfernoRGB(normalizedValue);
        color = `rgb(${r}, ${g}, ${b})`;
      }
      offscreenCtx.fillStyle = color;
      offscreenCtx.fillRect(
        finalScreenX,
        finalScreenY,
        cellRenderWidth,
        cellRenderHeight
      );
    }

    ctx.drawImage(offscreenCanvas, 0, 0);

    // Draw channel names if provided and visible
    if (channels && channels.length > 0) {
      ctx.fillStyle = "black"; // Or a contrasting color
      ctx.font = "12px Arial";
      const yChannelPositions = Array.from(
        new Set(currentData.map((p) => p.y))
      ).sort((a, b) => a - b);

      yChannelPositions.forEach((yCoord) => {
        const screenY =
          (yCoord - visibleY) * currentZoom + cellRenderHeight / 2; // Center text in cell
        if (screenY > 0 && screenY < height) {
          // Only draw if visible
          const channelIndex = yCoord - dataExtentsRef.current.minY; // Assuming y Coords are 0-indexed from minY
          if (channelIndex >= 0 && channelIndex < channels.length) {
            // Adjusted to draw to the left of the heatmap
            ctx.fillText(channels[channelIndex], 5, screenY);
          }
        }
      });
    }
  }, [
    data,
    zoom,
    pan,
    currentCanvasWidth,
    height,
    colorRange,
    nullValueColor,
    channels, // Added channels
    dataExtentsRef, // Added dataExtentsRef
  ]);

  // Effect 3: Trigger redraw when drawHeatmap callback changes (due to its dependencies changing)
  useEffect(() => {
    const rafId = requestAnimationFrame(drawHeatmap);
    return () => cancelAnimationFrame(rafId);
  }, [drawHeatmap]); // Redraw when the callback itself changes

  // --- Interaction Handlers ---
  const handleWheel = useCallback(
    (e: globalThis.WheelEvent) => {
      // Only zoom if Meta (Cmd on Mac) or Ctrl key is pressed
      if (!e.metaKey && !e.ctrlKey) {
        return; // Allow default scroll behavior
      }

      e.preventDefault(); // Prevent default scrolling behavior
      e.stopPropagation(); // Stop event from propagating up to the page

      const currentZoom = zoom;
      const currentPan = pan;
      const delta = -e.deltaY;
      const scale = delta > 0 ? 1.1 : 1 / 1.1;

      // Apply dynamicMinZoom and MAX_ZOOM_LEVEL
      const newZoom = Math.min(
        Math.max(currentZoom * scale, dynamicMinZoom),
        MAX_ZOOM_LEVEL
      );

      const targetCanvas = e.currentTarget as HTMLCanvasElement;
      if (!targetCanvas) return;
      const rect = targetCanvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const worldXBefore = currentPan.x + mouseX / currentZoom;
      const worldYBefore = currentPan.y + mouseY / currentZoom;
      const newPanX = worldXBefore - mouseX / newZoom;
      const newPanY = worldYBefore - mouseY / newZoom;
      setZoom(newZoom); // Schedule state update
      setPan({ x: newPanX, y: newPanY }); // Schedule state update
    },
    [zoom, pan, dynamicMinZoom]
  );

  // Effect 4: Attach non-passive wheel event listener
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // The actual handler function that calls our useCallback version
    const wheelListener = (event: globalThis.WheelEvent) => {
      handleWheel(event);
    };

    // Explicitly type options or cast to any if TS struggles with passive: false recognition
    const eventOptions: AddEventListenerOptions = { passive: false };

    canvas.addEventListener("wheel", wheelListener, eventOptions);

    return () => {
      canvas.removeEventListener("wheel", wheelListener, eventOptions); // Use same options for removal
    };
  }, [handleWheel]); // Re-attach if handleWheel changes (due to zoom/pan changing)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    (e.target as HTMLElement).style.cursor = "grabbing";
  }, []); // No dependencies needed

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      // Update pan based on previous pan state and drag delta
      setPan((prevPan) => ({
        x: prevPan.x - dx / zoom, // Use current zoom state here
        y: prevPan.y - dy / zoom,
      }));
      // Update drag start position for next move calculation
      setDragStart({ x: e.clientX, y: e.clientY });
    },
    [isDragging, dragStart, zoom]
  ); // Depends on isDragging, dragStart, zoom

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        setIsDragging(false);
        (e.target as HTMLElement).style.cursor = "grab";
      }
    },
    [isDragging]
  ); // Depends on isDragging

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        setIsDragging(false);
        (e.target as HTMLElement).style.cursor = "grab";
      }
    },
    [isDragging]
  ); // Depends on isDragging

  const resetView = useCallback(() => {
    if (data.length > 0) {
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const point of data) {
        if (isNaN(point.x) || isNaN(point.y)) continue;
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
      }
      minX = isFinite(minX) ? minX : 0;
      maxX = isFinite(maxX) ? maxX : currentCanvasWidth; // Use dynamic width
      minY = isFinite(minY) ? minY : 0;
      maxY = isFinite(maxY) ? maxY : height; // Use prop height
      if (maxX <= minX) maxX = minX + 1;
      if (maxY <= minY) maxY = minY + 1;
      const dataWidth = maxX - minX;
      const dataHeight = maxY - minY;
      // Use dynamic width for zoom calculation
      const zoomX = dataWidth > 0 ? currentCanvasWidth / dataWidth : 1;
      const zoomY = dataHeight > 0 ? height / dataHeight : 1;
      let initialZoom = Math.min(zoomX, zoomY) * 0.9;
      initialZoom = Math.max(0.001, Math.min(initialZoom, 10));
      const dataCenterX = minX + dataWidth / 2;
      const dataCenterY = minY + dataHeight / 2;
      // Use dynamic width for pan calculation
      const initialPanX = dataCenterX - currentCanvasWidth / (2 * initialZoom);
      const initialPanY = dataCenterY - height / (2 * initialZoom);
      setZoom(initialZoom);
      setPan({ x: initialPanX, y: initialPanY });
      setDynamicMinZoom(Math.max(0.01, initialZoom * MIN_INITIAL_ZOOM_FACTOR)); // Also set dynamic min zoom on reset
      initialViewCalculated.current = true;
    } else {
      setZoom(DEFAULT_ZOOM);
      setPan(DEFAULT_PAN);
      setDynamicMinZoom(0.1); // Reset to default if no data
    }
  }, [data, currentCanvasWidth, height]); // Dependencies updated

  // --- Helper for safe number formatting ---
  const formatNumber = (num: number | undefined | null, fixed = 0): string => {
    if (typeof num !== "number" || isNaN(num)) return "...";
    return num.toFixed(fixed);
  };
  const formatZoom = (num: number | undefined | null, fixed = 2): string => {
    if (typeof num !== "number" || isNaN(num)) return "...";
    return num.toFixed(fixed);
  };

  // Effect 5: ResizeObserver for dynamic canvas width
  useEffect(() => {
    const containerElement = heatmapContainerRef.current;
    if (!containerElement) return;

    // Set initial width based on the container's actual rendered width
    setCurrentCanvasWidth(containerElement.offsetWidth);

    const observer = new ResizeObserver((entries) => {
      if (!entries || !entries.length) return;
      const newWidth = entries[0].contentRect.width;

      // Use rAF to batch updates and avoid layout thrashing
      requestAnimationFrame(() => {
        // Check if the element is still mounted and width has actually changed
        if (
          heatmapContainerRef.current &&
          heatmapContainerRef.current.offsetWidth === newWidth
        ) {
          setCurrentCanvasWidth(newWidth);
        }
      });
    });

    observer.observe(containerElement);

    return () => {
      observer.unobserve(containerElement); // Clean up observer
    };
  }, []); // Run once on mount to set up the observer

  // --- Render Logic ---
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" onClick={resetView}>
            {" "}
            Reset View{" "}
          </Button>
          {/* Use safe formatters */}
          <span className="text-sm tabular-nums whitespace-nowrap">
            Zoom: {formatZoom(zoom)}x | Pan: ({formatNumber(pan?.x)},{" "}
            {formatNumber(pan?.y)})
          </span>
        </div>
        <div className="text-sm whitespace-nowrap">
          Data points: {data.length}
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
        <div className="absolute top-3 right-3 flex flex-col space-y-2 z-10">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              handleWheel({
                deltaY: -100,
                clientX: currentCanvasWidth / 2,
                clientY: height / 2,
                currentTarget: canvasRef.current,
                preventDefault: () => {},
              } as any)
            }
            className="w-8 h-8 p-0"
            aria-label="Zoom In"
          >
            {" "}
            +{" "}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              handleWheel({
                deltaY: 100,
                clientX: currentCanvasWidth / 2,
                clientY: height / 2,
                currentTarget: canvasRef.current,
                preventDefault: () => {},
              } as any)
            }
            className="w-8 h-8 p-0"
            aria-label="Zoom Out"
          >
            {" "}
            -{" "}
          </Button>
        </div>
      </div>
    </div>
  );
}
