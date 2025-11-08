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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TrendingUp, Maximize2, Minimize2 } from "lucide-react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface StreamingDDALinePlotProps {
  streamId: string;
  height?: number;
}

export function StreamingDDALinePlot({
  streamId,
  height = 400,
}: StreamingDDALinePlotProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

  const { latestResults, latestChunks, session, isRunning } = useStreamingData(streamId);
  const autoScroll = useAppStore((state) => state.streaming.ui.autoScroll);
  const displayWindowSeconds = useAppStore(
    (state) => state.streaming.ui.displayWindowSeconds,
  );

  // Detect visibility to pause processing when not visible
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );

    if (plotRef.current) {
      observer.observe(plotRef.current);
    }

    return () => observer.disconnect();
  }, []);

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

  // Get available channels from data chunks
  const availableChannels = useMemo(() => {
    if (latestChunks.length === 0) return [];
    // Get channel names from the first chunk
    return latestChunks[0].channel_names;
  }, [latestChunks]);

  // Select first variant by default
  useEffect(() => {
    if (!selectedVariant && availableVariants.length > 0) {
      setSelectedVariant(availableVariants[0]);
    }
  }, [availableVariants, selectedVariant]);

  // Select only first 3 channels by default (to avoid overwhelming the plot)
  useEffect(() => {
    if (selectedChannels.length === 0 && availableChannels.length > 0) {
      setSelectedChannels(availableChannels.slice(0, 3));
    }
  }, [availableChannels, selectedChannels]);

  // Process data for plotting
  const plotData = useMemo(() => {
    if (
      !isVisible ||
      latestResults.length === 0 ||
      !selectedVariant ||
      selectedChannels.length === 0
    ) {
      return null;
    }

    // Extract time series data for selected variant and channels
    const timestamps: number[] = [];
    const channelSeries: Map<string, number[]> = new Map();

    // Initialize series for each selected channel
    selectedChannels.forEach((channel) => {
      channelSeries.set(channel, []);
    });

    // Debug logging
    if (latestResults.length > 0) {
      const firstResult = latestResults[0];
      if (firstResult.q_matrices && firstResult.q_matrices[selectedVariant]) {
        const qMatrix = firstResult.q_matrices[selectedVariant];
        console.log(`[DDA LINE] First Q matrix shape: ${qMatrix.length} channels × ${qMatrix[0]?.length || 0} scales`);
      }
    }

    // Extract mean Q values for each channel over time
    const startTimestamp = latestResults[0].timestamp;

    for (const result of latestResults) {
      const variantSummary = result.variant_summaries[selectedVariant];
      if (!variantSummary) continue;

      // Convert to relative time in seconds
      const relativeTime = (result.timestamp - startTimestamp) / 1000.0;
      timestamps.push(relativeTime);

      // If we have Q matrices, extract per-channel values
      if (result.q_matrices && result.q_matrices[selectedVariant]) {
        const qMatrix = result.q_matrices[selectedVariant];

        selectedChannels.forEach((channelName, idx) => {
          if (idx < qMatrix.length) {
            // Average across scales for this channel
            const channelData = qMatrix[idx];
            const avgQ =
              channelData.reduce((sum, val) => sum + val, 0) /
              channelData.length;
            channelSeries.get(channelName)?.push(avgQ);
          } else {
            channelSeries.get(channelName)?.push(0);
          }
        });
      } else {
        // Fallback to summary stats (all channels get same value)
        selectedChannels.forEach((channelName) => {
          channelSeries.get(channelName)?.push(variantSummary.mean);
        });
      }
    }

    return {
      timestamps,
      channelSeries,
      variantName:
        latestResults[0].variant_summaries[selectedVariant]?.variant_name ||
        selectedVariant,
    };
  }, [
    latestResults,
    selectedVariant,
    selectedChannels,
    isVisible,
  ]);

  // Initialize and update plot
  useEffect(() => {
    if (!plotRef.current || !plotData) {
      return;
    }

    const { timestamps, channelSeries } = plotData;

    if (timestamps.length === 0) {
      return;
    }

    // Build uPlot data format: [timestamps, ...channel_series]
    const seriesData: number[][] = [
      timestamps,
      ...Array.from(channelSeries.values()),
    ];

    // Create or update plot
    if (!uplotRef.current) {
      // Initialize plot
      const opts: uPlot.Options = {
        width: plotRef.current.clientWidth,
        height: isFullscreen ? window.innerHeight - 200 : height,
        series: [
          {
            label: "Time (s)",
          },
          ...Array.from(channelSeries.keys()).map((channelName, idx) => ({
            label: channelName,
            stroke: `hsl(${(idx * 360) / channelSeries.size}, 70%, 50%)`,
            width: 2,
          })),
        ],
        axes: [
          {
            label: "Time (s)",
            labelSize: 20,
            space: 80, // Increase space between x-axis labels
          },
          {
            label: "Q Value",
            labelSize: 20,
          },
        ],
        scales: {
          x: {
            time: false,
          },
        },
        legend: {
          show: true,
          live: false,
        },
      };

      uplotRef.current = new uPlot(opts, seriesData, plotRef.current);
    } else {
      // Update existing plot
      uplotRef.current.setData(seriesData);

      // Auto-scroll to latest data
      if (autoScroll && timestamps.length > 0) {
        const maxTime = timestamps[timestamps.length - 1];
        const minTime = Math.max(0, maxTime - displayWindowSeconds);
        uplotRef.current.setScale("x", { min: minTime, max: maxTime });
      }
    }
  }, [plotData, height, isFullscreen, autoScroll, displayWindowSeconds]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, []);

  // Handle window resize
  useEffect(() => {
    if (!uplotRef.current || !plotRef.current) return;

    const handleResize = () => {
      if (uplotRef.current && plotRef.current) {
        uplotRef.current.setSize({
          width: plotRef.current.clientWidth,
          height: isFullscreen ? window.innerHeight - 200 : height,
        });
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [height, isFullscreen]);

  if (!session) {
    return null;
  }

  const handleToggleChannel = (channelName: string) => {
    setSelectedChannels((prev) =>
      prev.includes(channelName)
        ? prev.filter((ch) => ch !== channelName)
        : [...prev, channelName],
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Real-Time DDA Line Plot
              {isRunning && (
                <Badge variant="default" className="bg-green-500">
                  Live
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              DDA results over time for selected channels
            </CardDescription>
          </div>

          <div className="flex gap-2">
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
        {/* Controls */}
        <div className="flex items-center gap-6 text-sm">
          {/* Variant Selector */}
          {availableVariants.length > 0 && (
            <div className="flex items-center gap-2">
              <Label htmlFor="variant-select">Variant:</Label>
              <Select
                value={selectedVariant || undefined}
                onValueChange={setSelectedVariant}
              >
                <SelectTrigger id="variant-select" className="w-[150px]">
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
            </div>
          )}

          <Badge variant="outline">
            {selectedChannels.length} / {availableChannels.length} channels
          </Badge>
        </div>

        {/* Plot Container */}
        <div
          ref={plotRef}
          className={`border rounded-lg ${
            isFullscreen ? "fixed inset-4 z-50 bg-background p-4" : ""
          }`}
        />

        {/* Channel Legend */}
        {availableChannels.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {availableChannels.map((channelName, idx) => (
              <Badge
                key={channelName}
                variant={
                  selectedChannels.includes(channelName) ? "default" : "outline"
                }
                style={{
                  backgroundColor: selectedChannels.includes(channelName)
                    ? `hsl(${(idx * 360) / availableChannels.length}, 70%, 50%)`
                    : undefined,
                }}
                className="cursor-pointer"
                onClick={() => handleToggleChannel(channelName)}
              >
                {channelName}
              </Badge>
            ))}
          </div>
        )}

        {latestResults.length === 0 && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <TrendingUp className="h-8 w-8 mr-2 animate-pulse" />
            Waiting for DDA results...
          </div>
        )}
      </CardContent>
    </Card>
  );
}
