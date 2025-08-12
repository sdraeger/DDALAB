"use client";

import { useEffect, useRef, useMemo, useState } from "react";

export interface HeatmapPoint {
  x: number;
  y: number;
  value: number;
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

  // Simple color mapping function (blue to red)
  const valueToColor = (value: number): string => {
    const { min, max } = valueRange;
    const range = max - min;
    if (range === 0) return "rgb(128, 128, 128)";

    const normalized = (value - min) / range;

    // Simple blue to red gradient
    const red = Math.round(255 * normalized);
    const blue = Math.round(255 * (1 - normalized));
    const green = Math.round(128 * (1 - Math.abs(normalized - 0.5) * 2));

    return `rgb(${red}, ${green}, ${blue})`;
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
      <div className="flex-1 border rounded overflow-hidden">
        <canvas
          ref={canvasRef}
          width={Number(effectiveWidth)}
          height={Number(effectiveHeight)}
          className="block w-full h-full"
        />
      </div>
    </div>
  );
}
