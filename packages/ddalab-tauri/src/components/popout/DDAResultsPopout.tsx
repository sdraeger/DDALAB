import React, { useEffect, useRef, useState, useCallback } from "react";
import { PopoutLayout } from "./PopoutLayout";
import { usePopoutListener } from "@/hooks/usePopoutWindows";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Grid3x3,
  TrendingUp,
  Eye,
  BarChart3,
  Network,
} from "lucide-react";
import { DDAResult } from "@/types/api";
import { NetworkMotifPlot } from "@/components/dda/NetworkMotifPlot";
import { COLOR_SCHEME_FUNCTIONS } from "@/utils/colorSchemes";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface DDAResultsData {
  result: DDAResult;
  uiState?: {
    selectedVariant: number;
    colorScheme: ColorScheme;
    viewMode: ViewMode;
    selectedChannels: string[];
    colorRange: [number, number];
    autoScale: boolean;
  };
}

interface DDAResultsPopoutContentProps {
  data?: DDAResultsData;
  isLocked?: boolean;
  windowId?: string;
}

type ColorScheme = "viridis" | "plasma" | "inferno" | "jet" | "cool" | "hot";
type ViewMode = "heatmap" | "lineplot" | "all" | "network";

function DDAResultsPopoutContent({
  data,
  isLocked,
}: DDAResultsPopoutContentProps) {
  const heatmapRef = useRef<HTMLDivElement>(null);
  const linePlotRef = useRef<HTMLDivElement>(null);
  const uplotHeatmapRef = useRef<uPlot | null>(null);
  const uplotLinePlotRef = useRef<uPlot | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [colorScheme, setColorScheme] = useState<ColorScheme>("viridis");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [heatmapData, setHeatmapData] = useState<number[][]>([]);
  const [colorRange, setColorRange] = useState<[number, number]>([0, 1]);
  const [autoScale, setAutoScale] = useState(true);
  const [selectedVariant, setSelectedVariant] = useState<number>(0);

  const result = data?.result;

  // Get current variant or fallback to legacy structure
  const getCurrentVariant = () => {
    if (result?.results.variants && result.results.variants.length > 0) {
      return (
        result.results.variants[selectedVariant] || result.results.variants[0]
      );
    }
    // Fallback to legacy format
    if (result?.results.dda_matrix) {
      return {
        variant_id: "legacy",
        variant_name: "Combined Results",
        dda_matrix: result.results.dda_matrix,
        exponents: result.results.exponents || {},
        quality_metrics: result.results.quality_metrics || {},
      };
    }
    return null;
  };

  // Sync UI state from main window
  useEffect(() => {
    console.log("[POPOUT] Data received:", {
      hasData: !!data,
      hasUiState: !!data?.uiState,
      data,
    });
    if (data?.uiState) {
      const { uiState } = data;
      console.log("[POPOUT] Syncing UI state from main window:", uiState);
      setSelectedVariant(uiState.selectedVariant);
      setColorScheme(uiState.colorScheme);
      setViewMode(uiState.viewMode);
      setSelectedChannels(uiState.selectedChannels);
      setColorRange(uiState.colorRange);
      setAutoScale(uiState.autoScale);
      console.log("[POPOUT] UI state synced successfully");
    } else {
      console.warn("[POPOUT] No uiState in data!");
    }
  }, [data]);

  // Update selected channels when variant changes
  useEffect(() => {
    const currentVariant = getCurrentVariant();
    if (currentVariant?.dda_matrix) {
      const channels = Object.keys(currentVariant.dda_matrix);
      setSelectedChannels((prev) => {
        const prevSet = new Set(prev);
        const newSet = new Set(channels);
        const same =
          prev.length === channels.length && prev.every((ch) => newSet.has(ch));

        if (same) {
          return prev;
        }

        console.log("[POPOUT] Variant changed, updating selectedChannels:", {
          variantIndex: selectedVariant,
          variantId: currentVariant.variant_id,
          prevChannels: prev,
          newChannels: channels,
        });
        return channels;
      });
    }
  }, [selectedVariant, result?.id]);

  // Generate heatmap data from dda_matrix
  useEffect(() => {
    const currentVariant = getCurrentVariant();
    if (!currentVariant?.dda_matrix) return;

    const channels = selectedChannels;
    const dda_matrix = currentVariant.dda_matrix;

    const data: number[][] = [];
    const allValues: number[] = [];

    // Create 2D array: [channel][time_point] = dda_matrix value
    channels.forEach((channel) => {
      if (dda_matrix[channel]) {
        const channelData = dda_matrix[channel].map((val) => {
          // Log transform for better visualization
          const logVal = Math.log10(Math.max(0.001, val));
          allValues.push(logVal);
          return logVal;
        });
        data.push(channelData);
      }
    });

    // Calculate median and standard deviation for colorscale limits
    let minVal = Infinity;
    let maxVal = -Infinity;

    if (allValues.length > 0) {
      // Calculate median
      const sortedValues = [...allValues].sort((a, b) => a - b);
      const median =
        sortedValues.length % 2 === 0
          ? (sortedValues[sortedValues.length / 2 - 1] +
              sortedValues[sortedValues.length / 2]) /
            2
          : sortedValues[Math.floor(sortedValues.length / 2)];

      // Calculate standard deviation
      const mean =
        allValues.reduce((sum, val) => sum + val, 0) / allValues.length;
      const variance =
        allValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
        allValues.length;
      const std = Math.sqrt(variance);

      // Set colorscale limits to median ± 3 * std
      minVal = median - 3 * std;
      maxVal = median + 3 * std;

      console.log("[POPOUT HEATMAP] Color range:", {
        median,
        std,
        minVal,
        maxVal,
      });
    }

    setHeatmapData(data);

    if (autoScale) {
      setColorRange([minVal, maxVal]);
    }
  }, [result, selectedChannels, autoScale, selectedVariant]);

  const renderHeatmap = useCallback(() => {
    if (!heatmapRef.current || !result || heatmapData.length === 0 || isLocked)
      return;

    // Clean up existing plot
    if (uplotHeatmapRef.current) {
      uplotHeatmapRef.current.destroy();
      uplotHeatmapRef.current = null;
    }

    const width = heatmapRef.current.clientWidth;
    const height = Math.max(300, selectedChannels.length * 30 + 100);

    // Create canvas for heatmap rendering
    const canvas = document.createElement("canvas");
    canvas.width = result.results.scales.length;
    canvas.height = selectedChannels.length;
    const ctx = canvas.getContext("2d")!;

    // Render heatmap pixels
    const imageData = ctx.createImageData(canvas.width, canvas.height);
    const data = imageData.data;

    for (let y = 0; y < selectedChannels.length; y++) {
      for (let x = 0; x < result.results.scales.length; x++) {
        const value = heatmapData[y]?.[x] || 0;
        const normalized =
          (value - colorRange[0]) / (colorRange[1] - colorRange[0]);
        const clamped = Math.max(0, Math.min(1, normalized));

        const color = COLOR_SCHEME_FUNCTIONS[colorScheme](clamped);
        const rgb = color.match(/\d+/g)!.map(Number);

        const pixelIndex = (y * canvas.width + x) * 4;
        data[pixelIndex] = rgb[0]; // R
        data[pixelIndex + 1] = rgb[1]; // G
        data[pixelIndex + 2] = rgb[2]; // B
        data[pixelIndex + 3] = 255; // A
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Convert canvas to data URL for uPlot
    const dataURL = canvas.toDataURL();

    // Prepare data for uPlot (just coordinates for image positioning)
    const plotData: uPlot.AlignedData = [
      [0, result.results.scales[result.results.scales.length - 1]],
      [0, selectedChannels.length - 1],
    ];

    const opts: uPlot.Options = {
      width,
      height,
      scales: {
        x: {
          time: false,
          range: [
            result.results.scales[0],
            result.results.scales[result.results.scales.length - 1],
          ],
        },
        y: {
          range: [-0.5, selectedChannels.length - 0.5],
        },
      },
      axes: [
        {
          label: "Time Points",
          labelSize: 30,
          size: 50,
        },
        {
          label: "Channels",
          labelSize: 100,
          size: 120,
          values: (u, ticks) =>
            ticks.map((tick) => {
              const idx = Math.round(tick);
              return idx >= 0 && idx < selectedChannels.length
                ? selectedChannels[idx]
                : "";
            }),
        },
      ],
      series: [
        {},
        {
          paths: () => null,
          points: { show: false },
        },
      ],
      legend: {
        show: false, // Hide legend for heatmap as it doesn't add value
      },
      hooks: {
        drawClear: [
          (u) => {
            const ctx = u.ctx;
            const plotLeft = u.bbox.left;
            const plotTop = u.bbox.top;
            const plotWidth = u.bbox.width;
            const plotHeight = u.bbox.height;

            const img = new Image();
            img.onload = () => {
              ctx.drawImage(img, plotLeft, plotTop, plotWidth, plotHeight);
            };
            img.src = dataURL;
          },
        ],
      },
    };

    uplotHeatmapRef.current = new uPlot(opts, plotData, heatmapRef.current);
  }, [
    heatmapData,
    selectedChannels,
    result,
    colorRange,
    colorScheme,
    isLocked,
  ]);

  const renderLinePlot = useCallback(() => {
    const currentVariant = getCurrentVariant();
    if (!linePlotRef.current || !currentVariant?.dda_matrix || isLocked) return;

    // Clean up existing plot
    if (uplotLinePlotRef.current) {
      uplotLinePlotRef.current.destroy();
      uplotLinePlotRef.current = null;
    }

    // Prepare data for line plot
    const scales = result?.results.scales;

    // Defensive check for scales data
    if (!scales || !Array.isArray(scales) || scales.length === 0) {
      console.error("Invalid scales data for line plot:", scales);
      return;
    }

    const data: uPlot.AlignedData = [scales];

    // Add DDA matrix data for selected channels
    selectedChannels.forEach((channel) => {
      if (currentVariant.dda_matrix?.[channel]) {
        const channelData = currentVariant.dda_matrix[channel];
        if (Array.isArray(channelData) && channelData.length > 0) {
          data.push(channelData);
        } else {
          console.warn(`Invalid data for channel ${channel}:`, channelData);
        }
      }
    });

    // Check we have at least one data series besides x-axis
    if (data.length < 2) {
      console.error("No valid channel data for line plot");
      return;
    }

    // Create series configuration
    const series: uPlot.Series[] = [
      {}, // x-axis
      ...selectedChannels.map((channel, index) => ({
        label: `${channel}`,
        stroke: getChannelColor(index),
        width: 2,
        points: { show: false },
      })),
    ];

    const opts: uPlot.Options = {
      width: linePlotRef.current.clientWidth,
      height: 400,
      series,
      scales: {
        x: {
          time: false,
        },
        y: {},
      },
      axes: [
        {
          label: "Time Points",
          labelSize: 30,
          size: 50,
        },
        {
          label: "DDA Values",
          labelSize: 80,
          size: 80,
        },
      ],
      legend: {
        show: true,
        live: true,
      },
      cursor: {
        show: true,
        x: true,
        y: true,
        lock: true,
      },
    };

    uplotLinePlotRef.current = new uPlot(opts, data, linePlotRef.current);
  }, [result, selectedChannels, isLocked, selectedVariant]);

  const getChannelColor = (index: number): string => {
    const colors = [
      "#3b82f6",
      "#ef4444",
      "#10b981",
      "#f59e0b",
      "#8b5cf6",
      "#06b6d4",
      "#f97316",
      "#84cc16",
      "#ec4899",
      "#6366f1",
    ];
    return colors[index % colors.length];
  };

  const handleChannelToggle = (channel: string) => {
    setSelectedChannels((prev) =>
      prev.includes(channel)
        ? prev.filter((ch) => ch !== channel)
        : [...prev, channel],
    );
  };

  const handleRefresh = () => {
    if (!isLocked) {
      if (viewMode === "heatmap" || viewMode === "all") {
        renderHeatmap();
      }
      if (viewMode === "lineplot" || viewMode === "all") {
        renderLinePlot();
      }
    }
  };

  // Re-render plots when dependencies change
  useEffect(() => {
    if (viewMode === "heatmap" || viewMode === "all") {
      renderHeatmap();
    }
  }, [renderHeatmap, viewMode]);

  useEffect(() => {
    if (viewMode === "lineplot" || viewMode === "all") {
      renderLinePlot();
    }
  }, [renderLinePlot, viewMode]);

  if (!result) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-medium text-muted-foreground">
            No DDA Results
          </div>
          <div className="text-sm text-muted-foreground">
            Waiting for DDA analysis results...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col space-y-4 p-4">
      {/* Controls */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">
                DDA Results Visualization
              </CardTitle>
              <CardDescription>
                Analysis from {new Date(result.created_at).toLocaleDateString()}{" "}
                •{result.channels.length} channels
              </CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Variant Selection */}
          {result.results.variants && result.results.variants.length > 1 && (
            <div className="flex items-center space-x-2 pb-2 border-b">
              <Label className="text-sm font-medium">Variant:</Label>
              <div className="flex items-center gap-2">
                {result.results.variants.map((variant, idx) => (
                  <Badge
                    key={variant.variant_id}
                    variant={selectedVariant === idx ? "default" : "outline"}
                    className="cursor-not-allowed text-xs"
                    title="Synced from main window"
                  >
                    {variant.variant_name || variant.variant_id}
                  </Badge>
                ))}
              </div>
              <span className="text-xs text-muted-foreground ml-2">
                (controlled by main window)
              </span>
            </div>
          )}

          <div className="flex items-center justify-between">
            {/* View Mode */}
            <div className="flex items-center space-x-2">
              <Label className="text-sm">View:</Label>
              <Select
                value={viewMode}
                onValueChange={(value: ViewMode) => setViewMode(value)}
                disabled
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <div className="flex items-center">
                      <Eye className="h-4 w-4 mr-2" />
                      Both
                    </div>
                  </SelectItem>
                  <SelectItem value="heatmap">
                    <div className="flex items-center">
                      <Grid3x3 className="h-4 w-4 mr-2" />
                      Heatmap
                    </div>
                  </SelectItem>
                  <SelectItem value="lineplot">
                    <div className="flex items-center">
                      <TrendingUp className="h-4 w-4 mr-2" />
                      Line Plot
                    </div>
                  </SelectItem>
                  {getCurrentVariant()?.network_motifs && (
                    <SelectItem value="network">
                      <div className="flex items-center">
                        <Network className="h-4 w-4 mr-2" />
                        Network Motifs
                      </div>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Color Scheme (for heatmap) */}
            {(viewMode === "heatmap" || viewMode === "all") && (
              <div className="flex items-center space-x-2">
                <Label className="text-sm">Colors:</Label>
                <Select
                  value={colorScheme}
                  onValueChange={(value: ColorScheme) => setColorScheme(value)}
                  disabled
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viridis">Viridis</SelectItem>
                    <SelectItem value="plasma">Plasma</SelectItem>
                    <SelectItem value="inferno">Inferno</SelectItem>
                    <SelectItem value="jet">Jet</SelectItem>
                    <SelectItem value="cool">Cool</SelectItem>
                    <SelectItem value="hot">Hot</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Channel Selection */}
          <div>
            <Label className="text-sm mb-2 block">
              Channels ({selectedChannels.length} of {result.channels.length}{" "}
              selected)
            </Label>
            <div className="flex flex-wrap gap-2 max-h-20 overflow-y-auto">
              {result.channels.map((channel) => (
                <Badge
                  key={channel}
                  variant={
                    selectedChannels.includes(channel) ? "default" : "outline"
                  }
                  className="cursor-pointer text-xs"
                  onClick={() => handleChannelToggle(channel)}
                >
                  {channel}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Visualization Area */}
      <div className="flex-1 flex flex-col space-y-4">
        {/* Heatmap */}
        {(viewMode === "heatmap" || viewMode === "all") && (
          <Card className="flex-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">DDA Matrix Heatmap</CardTitle>
              <CardDescription>
                Log-transformed DDA matrix values across time points and
                channels
              </CardDescription>
            </CardHeader>
            <CardContent className="h-full">
              <div ref={heatmapRef} className="w-full h-full min-h-[300px]" />
            </CardContent>
          </Card>
        )}

        {/* Line Plot */}
        {(viewMode === "lineplot" || viewMode === "all") && (
          <Card className="flex-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">DDA Time Series</CardTitle>
              <CardDescription>
                DDA output time series - one line per channel (each row of the
                DDA matrix)
              </CardDescription>
            </CardHeader>
            <CardContent className="h-full">
              <div ref={linePlotRef} className="w-full h-full min-h-[400px]" />
            </CardContent>
          </Card>
        )}

        {/* Network Motifs (CD-DDA only) */}
        {(viewMode === "network" || viewMode === "all") &&
          getCurrentVariant()?.network_motifs && (
            <Card className="flex-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Network Motifs</CardTitle>
                <CardDescription>
                  Directed network graphs showing cross-dynamical relationships
                  between channels at different delays
                </CardDescription>
              </CardHeader>
              <CardContent className="h-full min-h-[300px]">
                <NetworkMotifPlot data={getCurrentVariant()!.network_motifs!} />
              </CardContent>
            </Card>
          )}
      </div>
    </div>
  );
}

export default function DDAResultsPopout() {
  const { data, isLocked, windowId } = usePopoutListener();

  return (
    <PopoutLayout title="DDA Analysis Results" showRefresh={true}>
      <DDAResultsPopoutContent
        data={data}
        isLocked={isLocked}
        windowId={windowId || undefined}
      />
    </PopoutLayout>
  );
}
