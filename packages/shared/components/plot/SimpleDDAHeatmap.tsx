"use client";

import { useEffect, useRef, useMemo, useState } from "react";

export interface HeatmapPoint {
  x: number;
  y: number;
  value: number;
  originalX?: number; // Original coordinates before downsampling
  originalY?: number; // Original coordinates before downsampling
}

interface SimpleDDAHeatmapProps {
  data: HeatmapPoint[];
  width?: number | string;
  height?: number | string;
  channels?: string[];
}

export function SimpleDDAHeatmap({
  data,
  width = 800,
  height = 400,
  channels,
}: SimpleDDAHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 400 });
  
  // Cursor tracking state
  const [cursorInfo, setCursorInfo] = useState<{
    x: number;
    y: number;
    dataX: number;
    dataY: number;
    value: number | null;
    visible: boolean;
  } | null>(null);

  // Responsive sizing
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({
          width: rect.width,
          height: rect.height,
        });
      }
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);

  // Use container size if width/height are percentages, otherwise use provided values
  const effectiveWidth = typeof width === 'string' && width.includes('%') ? containerSize.width : Number(width);
  const effectiveHeight = typeof height === 'string' && height.includes('%') ? containerSize.height : Number(height);

  // Process data to find dimensions and value range
  const { dimensions, valueRange, dataGrid } = useMemo(() => {
    if (data.length === 0) {
      return {
        dimensions: { minX: 0, maxX: 1, minY: 0, maxY: 1, width: 1, height: 1 },
        valueRange: { min: 0, max: 1 },
        dataGrid: new Map<string, number>(),
      };
    }

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    let minValue = Infinity,
      maxValue = -Infinity;
    const grid = new Map<string, number>();

    for (const point of data) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      minValue = Math.min(minValue, point.value);
      maxValue = Math.max(maxValue, point.value);

      grid.set(`${point.x},${point.y}`, point.value);
    }

    return {
      dimensions: {
        minX,
        maxX,
        minY,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      },
      valueRange: { min: minValue, max: maxValue },
      dataGrid: grid,
    };
  }, [data]);

  // Improved color mapping using inferno colormap (same as main DDAHeatmap)
  const valueToColor = (value: number): string => {
    const { min, max } = valueRange;
    const range = max - min;
    if (range === 0) return "rgb(128, 128, 128)";

    const normalized = Math.min(Math.max((value - min) / range, 0), 1);

    // Inferno colormap control points
    const infernoPoints = [
      { t: 0.0, rgb: [0, 0, 4] },
      { t: 0.2, rgb: [20, 11, 52] },
      { t: 0.4, rgb: [66, 10, 104] },
      { t: 0.6, rgb: [147, 38, 103] },
      { t: 0.8, rgb: [229, 92, 48] },
      { t: 1.0, rgb: [252, 255, 164] },
    ];

    // Find the appropriate color segment
    for (let i = 0; i < infernoPoints.length - 1; i++) {
      const p1 = infernoPoints[i];
      const p2 = infernoPoints[i + 1];

      if (normalized >= p1.t && normalized <= p2.t) {
        const segmentT = (normalized - p1.t) / (p2.t - p1.t);
        const r = Math.round(p1.rgb[0] + (p2.rgb[0] - p1.rgb[0]) * segmentT);
        const g = Math.round(p1.rgb[1] + (p2.rgb[1] - p1.rgb[1]) * segmentT);
        const b = Math.round(p1.rgb[2] + (p2.rgb[2] - p1.rgb[2]) * segmentT);
        return `rgb(${r}, ${g}, ${b})`;
      }
    }

    return `rgb(${infernoPoints[infernoPoints.length - 1].rgb.join(', ')})`;
  };

  // Draw the heatmap
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    console.log("[SimpleDDAHeatmap] Drawing heatmap:", {
      dataPoints: data.length,
      dimensions,
      valueRange,
      canvasSize: { width: effectiveWidth, height: effectiveHeight },
    });

    // Clear canvas
    ctx.clearRect(0, 0, Number(effectiveWidth), Number(effectiveHeight));

    // Calculate cell size
    const cellWidth = Number(effectiveWidth) / dimensions.width;
    const cellHeight = Number(effectiveHeight) / dimensions.height;

    console.log("[SimpleDDAHeatmap] Cell dimensions:", {
      cellWidth,
      cellHeight,
    });

    // Draw each data point as a rectangle
    for (const point of data) {
      const x = (point.x - dimensions.minX) * cellWidth;
      const y = (point.y - dimensions.minY) * cellHeight;

      ctx.fillStyle = valueToColor(point.value);
      ctx.fillRect(x, y, cellWidth, cellHeight);
    }

    // Draw grid lines for better visibility
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 0.5;

    // Vertical lines
    for (let i = 0; i <= dimensions.width; i++) {
      const x = i * cellWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, Number(effectiveHeight));
      ctx.stroke();
    }

    // Horizontal lines
    for (let i = 0; i <= dimensions.height; i++) {
      const y = i * cellHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(Number(effectiveWidth), y);
      ctx.stroke();
    }

    // Draw channel labels if provided
    if (channels && channels.length > 0) {
      ctx.fillStyle = "white";
      ctx.strokeStyle = "black";
      ctx.lineWidth = 2;
      ctx.font = "12px Arial";

      const labelHeight = effectiveHeight / channels.length;

      channels.forEach((channel, index) => {
        const y = (index + 0.5) * labelHeight;
        ctx.strokeText(channel, 5, y);
        ctx.fillText(channel, 5, y);
      });
    }

    console.log("[SimpleDDAHeatmap] Heatmap drawing completed");
  }, [data, dimensions, valueRange, effectiveWidth, effectiveHeight, channels]);

  // Mouse tracking handlers
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Calculate cell size
    const cellWidth = Number(effectiveWidth) / dimensions.width;
    const cellHeight = Number(effectiveHeight) / dimensions.height;

    // Map canvas coordinates to data coordinates
    const dataX = Math.floor(canvasX / cellWidth) + dimensions.minX;
    const dataY = Math.floor(canvasY / cellHeight) + dimensions.minY;

    // Find the value at this position
    const gridKey = `${dataX},${dataY}`;
    const value = dataGrid.get(gridKey) ?? null;
    
    // Find the actual data point to get original coordinates if available
    const dataPoint = data.find(point => point.x === dataX && point.y === dataY);
    const displayX = dataPoint?.originalX ?? dataX;
    const displayY = dataPoint?.originalY ?? dataY;

    setCursorInfo({
      x: canvasX,
      y: canvasY,
      dataX: displayX, // Use original coordinates for display
      dataY: displayY, // Use original coordinates for display
      value,
      visible: true,
    });
  };

  const handleMouseLeave = () => {
    setCursorInfo(null);
  };

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center border rounded bg-muted/10"
        style={{ width: effectiveWidth, height: effectiveHeight }}
        ref={containerRef}
      >
        <div className="text-center text-muted-foreground">
          <p className="text-sm">No heatmap data available</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full flex flex-col">
      <div className="flex justify-between text-xs text-muted-foreground mb-2">
        <span>Data points: {data.length}</span>
        <span>
          Size: {dimensions.width}×{dimensions.height}
        </span>
        <span>
          Range: {valueRange.min.toFixed(3)} - {valueRange.max.toFixed(3)}
        </span>
      </div>
      <div className="flex-1 border rounded overflow-hidden relative">
        <canvas
          ref={canvasRef}
          width={Number(effectiveWidth)}
          height={Number(effectiveHeight)}
          className="block w-full h-full cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
        
        {/* Cursor info overlay */}
        {cursorInfo && cursorInfo.visible && (
          <div 
            className="absolute pointer-events-none z-20 bg-black/80 text-white px-2 py-1 rounded text-xs whitespace-nowrap"
            style={{
              left: Math.min(cursorInfo.x + 10, Number(effectiveWidth) - 120),
              top: Math.max(cursorInfo.y - 30, 10),
            }}
          >
            <div>X: {cursorInfo.dataX}, Y: {cursorInfo.dataY}</div>
            <div>Q: {cursorInfo.value !== null ? cursorInfo.value.toFixed(4) : 'N/A'}</div>
          </div>
        )}
      </div>
    </div>
  );
}
