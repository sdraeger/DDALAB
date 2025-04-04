// ddalab-web/components/dda-heatmap-new.tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";

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

export function DDAHeatmap({
  data,
  width = 800,
  height = 600,
}: DDAHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Ensure state has valid initial values
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [pan, setPan] = useState<{ x: number; y: number }>(DEFAULT_PAN);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [colorRange, setColorRange] = useState<[number, number]>([0, 1]);
  const initialViewCalculated = useRef(false);

  // Effect 1: Calculate data bounds and initial view setting
  useEffect(() => {
    // console.log("Heatmap data received, length:", data.length);
    if (data.length === 0) {
      // Reset view and flag when data is cleared
      initialViewCalculated.current = false;
      setZoom(DEFAULT_ZOOM);
      setPan(DEFAULT_PAN);
      setColorRange([0, 1]);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, width, height);
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

      const zoomX = dataWidth > 0 ? width / dataWidth : 1;
      const zoomY = dataHeight > 0 ? height / dataHeight : 1;
      let newInitialZoom = Math.min(zoomX, zoomY) * 0.9;
      newInitialZoom = Math.max(0.001, Math.min(newInitialZoom, 10)); // Clamp zoom

      const dataCenterX = minX + dataWidth / 2;
      const dataCenterY = minY + dataHeight / 2;

      // Calculate pan based on the *new* initial zoom
      const newInitialPanX = dataCenterX - width / (2 * newInitialZoom);
      const newInitialPanY = dataCenterY - height / (2 * newInitialZoom);

      console.log(
        `Setting Initial View: Zoom=${newInitialZoom.toFixed(4)}, Pan=(${newInitialPanX.toFixed(2)}, ${newInitialPanY.toFixed(2)})`
      );
      setZoom(newInitialZoom); // Set state
      setPan({ x: newInitialPanX, y: newInitialPanY }); // Set state
      initialViewCalculated.current = true;
    }
  }, [data, width, height]); // Dependencies are correct

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

    ctx.clearRect(0, 0, width, height);

    if (currentData.length === 0) return;

    const visibleWidth = width / currentZoom;
    const visibleHeight = height / currentZoom;
    const visibleX = currentPan.x;
    const visibleY = currentPan.y;

    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = width;
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
      const r = Math.floor(normalizedValue * 255);
      const g = 0;
      const b = Math.floor((1 - normalizedValue) * 255);
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

    // if (drawnPoints === 0 && currentData.length > 0) { console.warn("No points drawn in visible area."); }

    ctx.drawImage(offscreenCanvas, 0, 0);
  }, [data, width, height, zoom, pan, colorRange]); // Keep dependencies for useCallback

  // Effect 3: Trigger redraw when drawHeatmap callback changes (due to its dependencies changing)
  useEffect(() => {
    const rafId = requestAnimationFrame(drawHeatmap);
    return () => cancelAnimationFrame(rafId);
  }, [drawHeatmap]); // Redraw when the callback itself changes

  // --- Interaction Handlers (Remain unchanged from previous version) ---
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const currentZoom = zoom; // Read current state
      const currentPan = pan; // Read current state
      const delta = -e.deltaY;
      const scale = delta > 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.min(Math.max(currentZoom * scale, 0.001), 500);
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const worldXBefore = currentPan.x + mouseX / currentZoom;
      const worldYBefore = currentPan.y + mouseY / currentZoom;
      const newPanX = worldXBefore - mouseX / newZoom;
      const newPanY = worldYBefore - mouseY / newZoom;
      setZoom(newZoom); // Schedule state update
      setPan({ x: newPanX, y: newPanY }); // Schedule state update
    },
    [zoom, pan]
  ); // Depend on zoom and pan

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
    // The useEffect will handle resetting zoom and pan based on data
    // If data is empty, it resets to defaults. If data exists, it recalculates.
    // We might need to force a re-render if data hasn't changed but we want reset
    // A simple way is to slightly change a dependency of the useEffect, e.g., data itself?
    // Or trigger the calculation logic directly here ONLY IF data exists
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
      maxX = isFinite(maxX) ? maxX : width;
      minY = isFinite(minY) ? minY : 0;
      maxY = isFinite(maxY) ? maxY : height;
      if (maxX <= minX) maxX = minX + 1;
      if (maxY <= minY) maxY = minY + 1;
      const dataWidth = maxX - minX;
      const dataHeight = maxY - minY;
      const zoomX = dataWidth > 0 ? width / dataWidth : 1;
      const zoomY = dataHeight > 0 ? height / dataHeight : 1;
      let initialZoom = Math.min(zoomX, zoomY) * 0.9;
      initialZoom = Math.max(0.001, Math.min(initialZoom, 10));
      const dataCenterX = minX + dataWidth / 2;
      const dataCenterY = minY + dataHeight / 2;
      const initialPanX = dataCenterX - width / (2 * initialZoom);
      const initialPanY = dataCenterY - height / (2 * initialZoom);
      setZoom(initialZoom);
      setPan({ x: initialPanX, y: initialPanY });
      initialViewCalculated.current = true;
    } else {
      setZoom(DEFAULT_ZOOM);
      setPan(DEFAULT_PAN);
    }
  }, [data, width, height]); // Depend on data, width, height

  // --- Helper for safe number formatting ---
  const formatNumber = (num: number | undefined | null, fixed = 0): string => {
    if (typeof num !== "number" || isNaN(num)) return "...";
    return num.toFixed(fixed);
  };
  const formatZoom = (num: number | undefined | null, fixed = 2): string => {
    if (typeof num !== "number" || isNaN(num)) return "...";
    return num.toFixed(fixed);
  };

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
        className="border rounded-md overflow-hidden relative bg-background cursor-grab"
        style={{ width, height }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="block"
        />
        <div className="absolute bottom-4 right-4 flex flex-col space-y-2 z-10">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              handleWheel({
                deltaY: -100,
                clientX: width / 2,
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
                clientX: width / 2,
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
