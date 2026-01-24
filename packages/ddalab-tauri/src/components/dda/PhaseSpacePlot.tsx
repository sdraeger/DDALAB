"use client";

import React, { useEffect, useRef, useState, useCallback, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as echarts from "echarts";
import "echarts-gl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2,
  RotateCcw,
  Download,
  ExternalLink,
  ChevronDown,
  Settings2,
} from "lucide-react";
import { usePopoutWindows } from "@/hooks/usePopoutWindows";
import { cn } from "@/lib/utils";

interface PhaseSpaceRequest {
  filePath: string;
  channelIndex: number;
  delay: number;
  maxPoints?: number;
  startSample?: number;
  endSample?: number;
}

interface PhaseSpaceResult {
  points: [number, number, number][];
  channelLabel: string;
  delaySamples: number;
  sampleRate: number;
  delayMs: number;
  numPoints: number;
}

interface PhaseSpacePlotProps {
  filePath: string;
  channels: string[];
  sampleRate: number;
  className?: string;
  isPopout?: boolean;
}

// Scientific color palette (Viridis-inspired)
const VIRIDIS_COLORS = [
  "#440154",
  "#482878",
  "#3e4a89",
  "#31688e",
  "#26828e",
  "#1f9e89",
  "#35b779",
  "#6ece58",
  "#b5de2b",
  "#fde725",
];

function PhaseSpacePlotComponent({
  filePath,
  channels,
  sampleRate,
  className,
  isPopout = false,
}: PhaseSpacePlotProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const { createWindow } = usePopoutWindows();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PhaseSpaceResult | null>(null);
  const [controlsOpen, setControlsOpen] = useState(true);

  // Controls
  const [selectedChannel, setSelectedChannel] = useState(0);
  const [delay, setDelay] = useState(10);
  const [maxPoints, setMaxPoints] = useState(8000);

  // Initialize chart
  useEffect(() => {
    if (!chartRef.current) return;
    if (chartInstanceRef.current) return;

    const chart = echarts.init(chartRef.current, "dark", {
      renderer: "canvas",
    });
    chartInstanceRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => chart?.resize());
    });
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chart?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  // Compute phase space data
  const computePhaseSpace = useCallback(async () => {
    if (!filePath || channels.length === 0) return;

    setIsLoading(true);
    setError(null);

    try {
      const request: PhaseSpaceRequest = {
        filePath,
        channelIndex: selectedChannel,
        delay,
        maxPoints,
      };

      const data = await invoke<PhaseSpaceResult>("compute_phase_space", {
        request,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [filePath, selectedChannel, delay, maxPoints, channels.length]);

  // Render chart when data changes
  useEffect(() => {
    if (!chartInstanceRef.current || !result) return;

    const chart = chartInstanceRef.current;
    const zMin = Math.min(...result.points.map((p) => p[2]));
    const zMax = Math.max(...result.points.map((p) => p[2]));

    const option: any = {
      backgroundColor: "#0c0c0f",
      title: {
        text: `Phase Space Reconstruction`,
        subtext: `${result.channelLabel} | τ = ${result.delaySamples} samples (${result.delayMs.toFixed(1)} ms) | ${result.numPoints.toLocaleString()} points`,
        left: "center",
        top: 10,
        textStyle: {
          color: "#fafafa",
          fontSize: 16,
          fontWeight: 600,
        },
        subtextStyle: {
          color: "#a1a1aa",
          fontSize: 12,
        },
      },
      tooltip: {
        show: true,
        backgroundColor: "rgba(24, 24, 27, 0.95)",
        borderColor: "#3f3f46",
        textStyle: { color: "#fafafa" },
        formatter: (params: any) => {
          const [x, y, z] = params.value;
          return `<div style="font-family: monospace;">
            <div>x(t): ${x.toFixed(3)}</div>
            <div>x(t-τ): ${y.toFixed(3)}</div>
            <div>x(t-2τ): ${z.toFixed(3)}</div>
          </div>`;
        },
      },
      visualMap: {
        show: true,
        dimension: 2,
        min: zMin,
        max: zMax,
        inRange: {
          color: VIRIDIS_COLORS,
        },
        textStyle: { color: "#a1a1aa" },
        right: 20,
        bottom: 80,
        itemWidth: 12,
        itemHeight: 100,
      },
      grid3D: {
        boxWidth: 100,
        boxHeight: 100,
        boxDepth: 100,
        viewControl: {
          autoRotate: false,
          distance: 180,
          alpha: 25,
          beta: 45,
          minDistance: 50,
          maxDistance: 400,
        },
        light: {
          main: { intensity: 1.2, shadow: true },
          ambient: { intensity: 0.3 },
        },
        axisLabel: {
          textStyle: { color: "#71717a", fontSize: 10 },
        },
        axisLine: {
          lineStyle: { color: "#52525b", width: 2 },
        },
        splitLine: {
          lineStyle: { color: "#27272a", width: 1 },
        },
        axisPointer: {
          lineStyle: { color: "#a1a1aa" },
        },
      },
      xAxis3D: {
        name: "x(t)",
        type: "value",
        nameTextStyle: { color: "#fafafa", fontSize: 12 },
      },
      yAxis3D: {
        name: "x(t-τ)",
        type: "value",
        nameTextStyle: { color: "#fafafa", fontSize: 12 },
      },
      zAxis3D: {
        name: "x(t-2τ)",
        type: "value",
        nameTextStyle: { color: "#fafafa", fontSize: 12 },
      },
      series: [
        {
          type: "scatter3D",
          data: result.points,
          symbolSize: 3,
          itemStyle: {
            opacity: 0.85,
            borderWidth: 0,
          },
          emphasis: {
            itemStyle: {
              opacity: 1,
              symbolSize: 6,
            },
          },
        },
      ],
    };

    chart.setOption(option, true);
    // Force resize after setting options to ensure proper rendering
    requestAnimationFrame(() => chart.resize());
  }, [result]);

  // Initial load
  useEffect(() => {
    computePhaseSpace();
  }, []);

  const handleResetView = () => {
    if (!chartInstanceRef.current) return;
    chartInstanceRef.current.setOption({
      grid3D: {
        viewControl: {
          distance: 180,
          alpha: 25,
          beta: 45,
        },
      },
    });
  };

  const handleExport = () => {
    if (!chartInstanceRef.current) return;
    const url = chartInstanceRef.current.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: "#0c0c0f",
    });
    const link = document.createElement("a");
    link.href = url;
    link.download = `phase-space-${result?.channelLabel || "plot"}.png`;
    link.click();
  };

  const handlePopout = async () => {
    await createWindow("phase-space", `ch${selectedChannel}-${Date.now()}`, {
      filePath,
      channels,
      sampleRate,
      channelIndex: selectedChannel,
      delay,
    });
  };

  const delayMs = (delay / sampleRate) * 1000;

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-zinc-950 overflow-hidden",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-100">
            Phase Space:{" "}
            {result?.channelLabel || channels[selectedChannel] || "—"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-zinc-400 hover:text-zinc-100"
            onClick={handleResetView}
            disabled={!result}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset
          </Button>
          {!isPopout && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-zinc-400 hover:text-zinc-100"
              onClick={handlePopout}
              disabled={!result}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Pop Out
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-zinc-400 hover:text-zinc-100"
            onClick={handleExport}
            disabled={!result}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Export
          </Button>
        </div>
      </div>

      {/* Chart Container */}
      <div className="relative h-[500px] bg-[#0c0c0f]">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 z-10">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-zinc-400">
                Computing attractor...
              </span>
            </div>
          </div>
        )}
        {error && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-sm text-destructive text-center px-8 max-w-md">
              {error}
            </div>
          </div>
        )}
        {!result && !isLoading && !error && (
          <div className="absolute inset-0 flex flex-col gap-4 p-8">
            <Skeleton className="h-full w-full bg-zinc-900" />
          </div>
        )}
        <div ref={chartRef} className="absolute inset-0" />
      </div>

      {/* Controls */}
      <Collapsible open={controlsOpen} onOpenChange={setControlsOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between px-4 py-2 border-t border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/50 transition-colors">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Settings2 className="h-3.5 w-3.5" />
              Controls
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-zinc-500 transition-transform",
                controlsOpen && "rotate-180",
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-900/30">
            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">Channel</Label>
                <Select
                  value={String(selectedChannel)}
                  onValueChange={(v) => setSelectedChannel(Number(v))}
                >
                  <SelectTrigger className="h-8 text-xs bg-zinc-900 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((ch, idx) => (
                      <SelectItem key={ch} value={String(idx)}>
                        {ch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">
                  Delay τ:{" "}
                  <span className="text-zinc-100 font-mono">
                    {delay} ({delayMs.toFixed(1)} ms)
                  </span>
                </Label>
                <Slider
                  value={[delay]}
                  onValueChange={([v]) => setDelay(v)}
                  min={1}
                  max={100}
                  step={1}
                  className="mt-2"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">
                  Points:{" "}
                  <span className="text-zinc-100 font-mono">
                    {maxPoints.toLocaleString()}
                  </span>
                </Label>
                <Slider
                  value={[maxPoints]}
                  onValueChange={([v]) => setMaxPoints(v)}
                  min={1000}
                  max={20000}
                  step={1000}
                  className="mt-2"
                />
              </div>
            </div>

            <div className="flex justify-end mt-4">
              <Button
                size="sm"
                onClick={computePhaseSpace}
                disabled={isLoading}
                className="h-8"
              >
                {isLoading && (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                )}
                Update
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export const PhaseSpacePlot = memo(PhaseSpacePlotComponent);
