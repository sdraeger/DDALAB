"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "./ui/button";

interface HeatmapPoint {
  x: number;
  y: number;
  value: number;
}

interface DDAHeatmapProps {
  data: HeatmapPoint[];
  width?: number;
  height?: number;
}

// Default values
const DEFAULT_ZOOM = 1;
const DEFAULT_PAN = { x: 0, y: 0 };
const MAX_ZOOM_LEVEL = 500; // Max zoom out
const MIN_INITIAL_ZOOM_FACTOR = 0.25; // User can zoom out to 25% of the initial fitted view

export function DDAHeatmap({
  data,
  width = 800,
  height = 600,
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

  // Effect 1: Calculate data bounds and initial view setting
  useEffect(() => {
    if (data.length === 0) {
      // Reset view and flag when data is cleared
      initialViewCalculated.current = false;
      setZoom(DEFAULT_ZOOM);
      setPan(DEFAULT_PAN);
      setColorRange([0, 1]);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, currentCanvasWidth, height);
      return;
    }

    let minVal = Infinity,
      maxVal = -Infinity;
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;

    for (const point of data) {
      if (
        typeof point?.x !== "number" ||
        typeof point?.y !== "number" ||
        typeof point?.value !== "number" ||
        isNaN(point.x) ||
        isNaN(point.y) ||
        isNaN(point.value)
      )
        continue;
      if (point.value < minVal) minVal = point.value;
      if (point.value > maxVal) maxVal = point.value;
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }

    // Safely determine bounds and color range
    minVal = isFinite(minVal) ? minVal : 0;
    maxVal = isFinite(maxVal) ? maxVal : minVal + 1; // Ensure max > min
    if (maxVal <= minVal) maxVal = minVal + 1;
    setColorRange([minVal, maxVal]);

    minX = isFinite(minX) ? minX : 0;
    maxX = isFinite(maxX) ? maxX : width;
    if (maxX <= minX) maxX = minX + 1;

    minY = isFinite(minY) ? minY : 0;
    maxY = isFinite(maxY) ? maxY : height;
    if (maxY <= minY) maxY = minY + 1;

    // Set initial view only once
    if (!initialViewCalculated.current) {
      const dataWidth = maxX - minX;
      const dataHeight = maxY - minY;

      // Use currentCanvasWidth for zoom calculation
      const zoomX = dataWidth > 0 ? currentCanvasWidth / dataWidth : 1;
      const zoomY = dataHeight > 0 ? height / dataHeight : 1;
      let newInitialZoom = Math.min(zoomX, zoomY) * 0.9;
      newInitialZoom = Math.max(0.001, Math.min(newInitialZoom, 10)); // Clamp zoom

      const dataCenterX = minX + dataWidth / 2;
      const dataCenterY = minY + dataHeight / 2;

      // Calculate pan based on the *new* initial zoom, using currentCanvasWidth
      const newInitialPanX =
        dataCenterX - currentCanvasWidth / (2 * newInitialZoom);
      const newInitialPanY = dataCenterY - height / (2 * newInitialZoom);

      console.log(
        `Setting Initial View: Zoom=${newInitialZoom.toFixed(
          4
        )}, Pan=(${newInitialPanX.toFixed(2)}, ${newInitialPanY.toFixed(2)})`
      );
      setZoom(newInitialZoom); // Set state
      setPan({ x: newInitialPanX, y: newInitialPanY }); // Set state
      setDynamicMinZoom(
        Math.max(0.01, newInitialZoom * MIN_INITIAL_ZOOM_FACTOR)
      ); // Set dynamic min zoom
      initialViewCalculated.current = true;
    }
  }, [data, currentCanvasWidth, height, initialViewCalculated]);

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

    // Use current state values directly
    const currentZoom = zoom;
    const currentPan = pan;
    const currentData = data;
    const currentColorRange = colorRange;

    // Use dynamic width and prop height for clearing and calculations
    ctx.clearRect(0, 0, currentCanvasWidth, height);

    if (currentData.length === 0) return;

    const visibleWidth = currentCanvasWidth / currentZoom;
    const visibleHeight = height / currentZoom;
    const visibleX = currentPan.x;
    const visibleY = currentPan.y;

    const offscreenCanvas = document.createElement("canvas");
    // Use dynamic width and prop height for offscreen canvas
    offscreenCanvas.width = currentCanvasWidth;
    offscreenCanvas.height = height;
    const offscreenCtx = offscreenCanvas.getContext("2d", { alpha: false });
    if (!offscreenCtx) return;

    const [minValue, maxValue] = currentColorRange;
    const valueRange = maxValue - minValue === 0 ? 1 : maxValue - minValue;

    let drawnPoints = 0;
    for (const point of currentData) {
      if (
        point.x < visibleX ||
        point.x > visibleX + visibleWidth ||
        point.y < visibleY ||
        point.y > visibleY + visibleHeight
      )
        continue;

      const screenX = (point.x - visibleX) * currentZoom;
      const screenY = (point.y - visibleY) * currentZoom;
      const normalizedValue = Math.max(
        0,
        Math.min(1, (point.value - minValue) / valueRange)
      );
      const [r, g, b] = intToInfernoRGB(normalizedValue);
      const color = `rgb(${r},${g},${b})`;
      const pointSize = Math.max(1, Math.ceil(currentZoom * 1.5));

      offscreenCtx.fillStyle = color;
      offscreenCtx.fillRect(
        Math.floor(screenX - pointSize / 2),
        Math.floor(screenY - pointSize / 2),
        pointSize,
        pointSize
      );
      drawnPoints++;
    }

    ctx.drawImage(offscreenCanvas, 0, 0);
  }, [data, currentCanvasWidth, height, zoom, pan, colorRange]);

  // Effect 3: Trigger redraw when drawHeatmap callback changes (due to its dependencies changing)
  useEffect(() => {
    const rafId = requestAnimationFrame(drawHeatmap);
    return () => cancelAnimationFrame(rafId);
  }, [drawHeatmap]); // Redraw when the callback itself changes

  // --- Interaction Handlers ---
  const handleWheel = useCallback(
    (e: globalThis.WheelEvent) => {
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
    initialViewCalculated.current = false; // Force recalculation in useEffect
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
