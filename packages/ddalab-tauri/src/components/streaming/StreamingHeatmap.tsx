"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useStreamingData } from "@/hooks/useStreamingData";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { TrendingUp, Maximize2, Minimize2, Download } from "lucide-react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface StreamingHeatmapProps {
  streamId: string;
  height?: number;
}

export function StreamingHeatmap({
  streamId,
  height = 400,
}: StreamingHeatmapProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);

  const { latestResults, session, isRunning } = useStreamingData(streamId);
  const autoScroll = useAppStore((state) => state.streaming.ui.autoScroll);

  // Get available variants
  const availableVariants = useMemo(() => {
    if (latestResults.length === 0) return [];

    const variants = new Set<string>();
    latestResults.forEach((result) => {
      Object.keys(result.variant_summaries).forEach((variantId) =>
        variants.add(variantId),
      );
    });

    return Array.from(variants);
  }, [latestResults]);

  // Select first variant by default
  useEffect(() => {
    if (!selectedVariant && availableVariants.length > 0) {
      setSelectedVariant(availableVariants[0]);
    }
  }, [availableVariants, selectedVariant]);

  // Process heatmap data
  const heatmapData = useMemo(() => {
    if (latestResults.length === 0 || !selectedVariant) {
      return null;
    }

    // Extract Q matrices for selected variant
    const qMatrices: number[][][] = [];
    const timestamps: number[] = [];

    for (const result of latestResults) {
      if (result.q_matrices && result.q_matrices[selectedVariant]) {
        qMatrices.push(result.q_matrices[selectedVariant]);
        timestamps.push(result.timestamp);
      } else if (result.variant_summaries[selectedVariant]) {
        // Use summary stats if Q matrices not available
        const summary = result.variant_summaries[selectedVariant];
        // Create a placeholder matrix using summary stats
        const placeholderMatrix = Array(summary.num_channels)
          .fill(0)
          .map(() => Array(summary.num_timepoints).fill(summary.mean));
        qMatrices.push(placeholderMatrix);
        timestamps.push(result.timestamp);
      }
    }

    if (qMatrices.length === 0) {
      return null;
    }

    // Flatten matrices into heatmap data [time][channel][scale]
    // For visualization, we'll show channel x time with color = Q value

    const numChannels = qMatrices[0].length;
    const numTimepoints = qMatrices[0][0].length;

    return {
      qMatrices,
      timestamps,
      numChannels,
      numTimepoints,
      variantName:
        latestResults[0].variant_summaries[selectedVariant]?.variant_name ||
        selectedVariant,
    };
  }, [latestResults, selectedVariant]);

  // Draw heatmap on canvas
  useEffect(() => {
    if (!plotRef.current || !heatmapData) {
      return;
    }

    const container = plotRef.current;
    const width = container.clientWidth;
    const plotHeight = isFullscreen ? window.innerHeight - 200 : height;

    // Create or get canvas
    if (!canvasRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = plotHeight;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      container.innerHTML = "";
      container.appendChild(canvas);
      canvasRef.current = canvas;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Update canvas size
    canvas.width = width;
    canvas.height = plotHeight;

    const { qMatrices, timestamps, numChannels, numTimepoints } = heatmapData;

    // Draw heatmap: one row per channel, one column per window
    const cellWidth = width / qMatrices.length;
    const cellHeight = plotHeight / numChannels;

    // Find global min/max for color scaling
    let minQ = Infinity;
    let maxQ = -Infinity;

    qMatrices.forEach((matrix) => {
      matrix.forEach((row) => {
        row.forEach((val) => {
          minQ = Math.min(minQ, val);
          maxQ = Math.max(maxQ, val);
        });
      });
    });

    // Draw each window
    qMatrices.forEach((matrix, windowIdx) => {
      const x = windowIdx * cellWidth;

      // For each channel, average across timepoints to get single color
      matrix.forEach((channelData, chIdx) => {
        const avgQ =
          channelData.reduce((sum, val) => sum + val, 0) / channelData.length;

        // Normalize to [0, 1]
        const normalized = (avgQ - minQ) / (maxQ - minQ || 1);

        // Color map: blue (low) -> green -> yellow -> red (high)
        const hue = (1 - normalized) * 240; // 240 = blue, 0 = red
        const color = `hsl(${hue}, 70%, 50%)`;

        ctx.fillStyle = color;
        ctx.fillRect(x, chIdx * cellHeight, cellWidth, cellHeight);
      });
    });

    // Draw grid lines
    ctx.strokeStyle = "rgba(0, 0, 0, 0.1)";
    ctx.lineWidth = 1;

    // Horizontal lines (channels)
    for (let i = 0; i <= numChannels; i++) {
      const y = i * cellHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Vertical lines (windows)
    for (let i = 0; i <= qMatrices.length; i++) {
      const x = i * cellWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, plotHeight);
      ctx.stroke();
    }

    // Draw color scale legend
    const legendWidth = 200;
    const legendHeight = 20;
    const legendX = width - legendWidth - 10;
    const legendY = 10;

    // Draw gradient
    const gradient = ctx.createLinearGradient(
      legendX,
      0,
      legendX + legendWidth,
      0,
    );
    gradient.addColorStop(0, "hsl(240, 70%, 50%)"); // Blue (low)
    gradient.addColorStop(0.5, "hsl(120, 70%, 50%)"); // Green
    gradient.addColorStop(1, "hsl(0, 70%, 50%)"); // Red (high)

    ctx.fillStyle = gradient;
    ctx.fillRect(legendX, legendY, legendWidth, legendHeight);

    // Draw legend border
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);

    // Draw legend labels
    ctx.fillStyle = "#000";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(minQ.toFixed(2), legendX, legendY + legendHeight + 15);
    ctx.fillText(
      maxQ.toFixed(2),
      legendX + legendWidth,
      legendY + legendHeight + 15,
    );
  }, [heatmapData, height, isFullscreen, autoScroll]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      // Trigger redraw by clearing canvas ref
      canvasRef.current = null;
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (!session) {
    return null;
  }

  const handleExport = () => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `streaming-heatmap-${streamId.slice(0, 8)}.png`;
    link.href = url;
    link.click();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Real-Time DDA Heatmap
              {isRunning && (
                <Badge variant="default" className="bg-green-500">
                  Live
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Streaming DDA results visualization
            </CardDescription>
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={handleExport}>
              <Download className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsFullscreen(!isFullscreen)}
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Variant Selector */}
        {availableVariants.length > 0 && (
          <div className="flex items-center gap-4">
            <Label htmlFor="variant-select">Variant:</Label>
            <Select
              value={selectedVariant || undefined}
              onValueChange={setSelectedVariant}
            >
              <SelectTrigger id="variant-select" className="w-[200px]">
                <SelectValue placeholder="Select variant" />
              </SelectTrigger>
              <SelectContent>
                {availableVariants.map((variantId) => (
                  <SelectItem key={variantId} value={variantId}>
                    {variantId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedVariant && heatmapData && (
              <Badge variant="outline">
                {heatmapData.numChannels} channels × {latestResults.length}{" "}
                windows
              </Badge>
            )}
          </div>
        )}

        {/* Heatmap Container */}
        <div
          ref={plotRef}
          className={`border rounded-lg bg-white ${
            isFullscreen ? "fixed inset-4 z-50 bg-background p-4" : ""
          }`}
          style={{ minHeight: height }}
        />

        {latestResults.length === 0 && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <TrendingUp className="h-8 w-8 mr-2 animate-pulse" />
            Waiting for DDA results...
          </div>
        )}

        {/* Summary Statistics */}
        {selectedVariant && latestResults.length > 0 && (
          <div className="grid grid-cols-4 gap-4 text-sm">
            {latestResults[latestResults.length - 1].variant_summaries[
              selectedVariant
            ] && (
              <>
                <div className="space-y-1">
                  <div className="text-muted-foreground">Mean Q</div>
                  <div className="font-medium">
                    {latestResults[latestResults.length - 1].variant_summaries[
                      selectedVariant
                    ].mean.toFixed(3)}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground">Std Dev</div>
                  <div className="font-medium">
                    {latestResults[latestResults.length - 1].variant_summaries[
                      selectedVariant
                    ].std_dev.toFixed(3)}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground">Min Q</div>
                  <div className="font-medium">
                    {latestResults[latestResults.length - 1].variant_summaries[
                      selectedVariant
                    ].min.toFixed(3)}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground">Max Q</div>
                  <div className="font-medium">
                    {latestResults[latestResults.length - 1].variant_summaries[
                      selectedVariant
                    ].max.toFixed(3)}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
