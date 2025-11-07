"use client";

import { useEffect, useRef, useState, useMemo } from "react";
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
import { Slider } from "@/components/ui/slider";
import { Activity, Maximize2, Minimize2 } from "lucide-react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface StreamingPlotProps {
  streamId: string;
  height?: number;
}

export function StreamingPlot({ streamId, height = 400 }: StreamingPlotProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { latestChunks, session, isRunning } = useStreamingData(streamId);
  const autoScroll = useAppStore((state) => state.streaming.ui.autoScroll);
  const visibleChannels = useAppStore(
    (state) => state.streaming.ui.visibleChannels,
  );
  const displayWindowSeconds = useAppStore(
    (state) => state.streaming.ui.displayWindowSeconds,
  );
  const updateStreamUI = useAppStore((state) => state.updateStreamUI);

  // Process data for plotting
  const plotData = useMemo(() => {
    if (latestChunks.length === 0 || !session) {
      return null;
    }

    // Get channel names from first chunk
    const channelNames = latestChunks[0].channel_names;

    // Filter channels if specified
    const activeChannels = visibleChannels
      ? channelNames.filter((name) => visibleChannels.includes(name))
      : channelNames;

    if (activeChannels.length === 0) {
      return null;
    }

    // Combine all chunks into continuous time series
    const sampleRate = latestChunks[0].sample_rate;
    let allSamples: number[][] = Array(activeChannels.length)
      .fill(0)
      .map(() => []);
    let timePoints: number[] = [];

    let currentTime = 0;
    for (const chunk of latestChunks) {
      const chunkSamples =
        chunk.samples.length > 0 ? chunk.samples[0].length : 0;

      for (let i = 0; i < chunkSamples; i++) {
        timePoints.push(currentTime);
        currentTime += 1.0 / sampleRate;

        for (let ch = 0; ch < activeChannels.length; ch++) {
          const channelIndex = channelNames.indexOf(activeChannels[ch]);
          if (channelIndex !== -1 && channelIndex < chunk.samples.length) {
            allSamples[ch].push(chunk.samples[channelIndex][i]);
          } else {
            allSamples[ch].push(0);
          }
        }
      }
    }

    // Limit to display window
    const maxSamples = Math.floor(displayWindowSeconds * sampleRate);
    if (timePoints.length > maxSamples && autoScroll) {
      const startIndex = timePoints.length - maxSamples;
      timePoints = timePoints.slice(startIndex);
      allSamples = allSamples.map((ch) => ch.slice(startIndex));
    }

    return {
      timePoints,
      samples: allSamples,
      channelNames: activeChannels,
      sampleRate,
    };
  }, [
    latestChunks,
    session,
    visibleChannels,
    displayWindowSeconds,
    autoScroll,
  ]);

  // Initialize and update plot
  useEffect(() => {
    if (!plotRef.current || !plotData) {
      return;
    }

    const { timePoints, samples, channelNames } = plotData;

    if (timePoints.length === 0) {
      return;
    }

    // Build uPlot data format
    const data: uPlot.AlignedData = [timePoints, ...samples];

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
          ...channelNames.map((name, idx) => ({
            label: name,
            stroke: `hsl(${(idx * 360) / channelNames.length}, 70%, 50%)`,
            width: 1,
          })),
        ],
        axes: [
          {
            label: "Time (s)",
            labelSize: 20,
          },
          {
            label: "Amplitude",
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

      uplotRef.current = new uPlot(opts, data, plotRef.current);
    } else {
      // Update existing plot
      uplotRef.current.setData(data);

      // Auto-scroll to latest data
      if (autoScroll && timePoints.length > 0) {
        const maxTime = timePoints[timePoints.length - 1];
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

  const channelNames = latestChunks[0]?.channel_names || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Real-Time Data Stream
              {isRunning && (
                <Badge variant="default" className="bg-green-500">
                  Live
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Showing last {displayWindowSeconds}s of streaming data
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
        {/* Plot Controls */}
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="auto-scroll"
              checked={autoScroll}
              onCheckedChange={(checked) =>
                updateStreamUI({ autoScroll: checked as boolean })
              }
            />
            <Label htmlFor="auto-scroll" className="cursor-pointer">
              Auto-scroll
            </Label>
          </div>

          <div className="flex items-center gap-2 flex-1">
            <Label htmlFor="window-size" className="whitespace-nowrap">
              Display window:
            </Label>
            <Slider
              id="window-size"
              min={5}
              max={60}
              step={5}
              value={[displayWindowSeconds]}
              onValueChange={([value]) =>
                updateStreamUI({ displayWindowSeconds: value })
              }
              className="flex-1 max-w-[200px]"
            />
            <span className="text-muted-foreground min-w-[3ch]">
              {displayWindowSeconds}s
            </span>
          </div>
        </div>

        {/* Plot Container */}
        <div
          ref={plotRef}
          className={`border rounded-lg ${
            isFullscreen ? "fixed inset-4 z-50 bg-background p-4" : ""
          }`}
        />

        {/* Channel Legend */}
        {channelNames.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {channelNames.map((name, idx) => (
              <Badge
                key={name}
                variant={
                  !visibleChannels || visibleChannels.includes(name)
                    ? "default"
                    : "outline"
                }
                style={{
                  backgroundColor:
                    !visibleChannels || visibleChannels.includes(name)
                      ? `hsl(${(idx * 360) / channelNames.length}, 70%, 50%)`
                      : undefined,
                }}
                className="cursor-pointer"
                onClick={() => {
                  const current = visibleChannels || channelNames;
                  const updated = current.includes(name)
                    ? current.filter((ch) => ch !== name)
                    : [...current, name];

                  updateStreamUI({
                    visibleChannels: updated.length > 0 ? updated : null,
                  });
                }}
              >
                {name}
              </Badge>
            ))}
          </div>
        )}

        {latestChunks.length === 0 && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Activity className="h-8 w-8 mr-2 animate-pulse" />
            Waiting for data...
          </div>
        )}
      </CardContent>
    </Card>
  );
}
