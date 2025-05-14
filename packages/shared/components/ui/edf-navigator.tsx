import React, { useState, useEffect, useMemo } from "react";
import { useLazyQuery } from "@apollo/client";
import { GET_EDF_NAVIGATION } from "../../lib/graphql/queries";
import { Button } from "./button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./card";
import { Slider } from "./slider";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
} from "./select";
import { Input } from "./input";
import {
  ChevronLeft,
  ChevronRight,
  SkipBack,
  SkipForward,
  Clock,
} from "lucide-react";

export interface ChunkInfo {
  start: number;
  end: number;
  size: number;
  timeSeconds: number;
  positionSeconds: number;
}

export interface NavigationInfo {
  totalSamples: number;
  fileDurationSeconds: number;
  numSignals: number;
  signalLabels: string[];
  samplingFrequencies: number[];
  chunks: ChunkInfo[];
}

interface EDFNavigatorProps {
  filePath: string;
  chunkSize?: number;
  onChunkSelect: (start: number, size: number) => void;
  currentChunkStart?: number;
  samplingFrequency?: number;
}

export function EDFNavigator({
  filePath,
  chunkSize = 51200,
  onChunkSelect,
  currentChunkStart = 0,
  samplingFrequency = 512,
}: EDFNavigatorProps) {
  const [navigationInfo, setNavigationInfo] = useState<NavigationInfo | null>(
    null
  );
  const [sliderValue, setSliderValue] = useState(0);
  const [jumpToTime, setJumpToTime] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");

  const [getNavigation, { loading, error, data }] = useLazyQuery(
    GET_EDF_NAVIGATION,
    {
      variables: { filename: filePath, chunkSize },
      fetchPolicy: "cache-and-network",
    }
  );

  // Load navigation info when component mounts or filePath/chunkSize changes
  useEffect(() => {
    if (filePath) {
      getNavigation();
    }
  }, [filePath, chunkSize, getNavigation]);

  // Update navigation info when data arrives
  useEffect(() => {
    if (data?.getEdfNavigation) {
      setNavigationInfo(data.getEdfNavigation);
    }
  }, [data]);

  // Update slider position when currentChunkStart changes
  useEffect(() => {
    if (navigationInfo && currentChunkStart !== undefined) {
      const positionSeconds = currentChunkStart / samplingFrequency;
      setSliderValue(positionSeconds);
    }
  }, [currentChunkStart, navigationInfo, samplingFrequency]);

  // Calculate current chunk index
  const currentChunkIndex = useMemo(() => {
    if (!navigationInfo) return 0;

    const index = navigationInfo.chunks.findIndex(
      (chunk) =>
        chunk.start <= currentChunkStart && currentChunkStart < chunk.end
    );
    return Math.max(0, index);
  }, [navigationInfo, currentChunkStart]);

  // Common time presets
  const timePresets = useMemo(
    () => [
      { label: "Start", value: "start", seconds: 0 },
      {
        label: "25%",
        value: "25%",
        seconds: navigationInfo?.fileDurationSeconds
          ? navigationInfo.fileDurationSeconds * 0.25
          : 0,
      },
      {
        label: "50%",
        value: "50%",
        seconds: navigationInfo?.fileDurationSeconds
          ? navigationInfo.fileDurationSeconds * 0.5
          : 0,
      },
      {
        label: "75%",
        value: "75%",
        seconds: navigationInfo?.fileDurationSeconds
          ? navigationInfo.fileDurationSeconds * 0.75
          : 0,
      },
      {
        label: "End",
        value: "end",
        seconds: navigationInfo?.fileDurationSeconds || 0,
      },
    ],
    [navigationInfo]
  );

  // Format time for display (HH:MM:SS.ms)
  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms
      .toString()
      .padStart(3, "0")}`;
  };

  // Format samples for display
  const formatSamples = (samples: number): string => {
    return samples.toLocaleString();
  };

  // Handle slider change
  const handleSliderChange = (newValue: number[]) => {
    setSliderValue(newValue[0]);
  };

  // Handle slider commit (when user stops dragging)
  const handleSliderCommit = (newValue: number[]) => {
    if (!navigationInfo) return;

    const targetSeconds = newValue[0];
    const targetSample = Math.floor(targetSeconds * samplingFrequency);

    // Find the appropriate chunk
    const targetChunk = navigationInfo.chunks.find(
      (chunk) =>
        chunk.positionSeconds <= targetSeconds &&
        targetSeconds < chunk.positionSeconds + chunk.timeSeconds
    );

    if (targetChunk) {
      onChunkSelect(targetChunk.start, targetChunk.size);
    } else {
      // Fallback to direct sample calculation if we can't find the exact chunk
      onChunkSelect(targetSample, chunkSize);
    }
  };

  // Handle time input change
  const handleTimeInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setJumpToTime(e.target.value);
  };

  // Handle time jump
  const handleTimeJump = () => {
    if (!jumpToTime || !navigationInfo) return;

    // Parse time in format HH:MM:SS.ms
    const timeParts = jumpToTime.split(":");
    if (timeParts.length < 2) return;

    let seconds = 0;
    if (timeParts.length === 3) {
      // Format: HH:MM:SS or HH:MM:SS.ms
      const hoursPart = parseInt(timeParts[0]) || 0;
      const minutesPart = parseInt(timeParts[1]) || 0;

      const secondsParts = timeParts[2].split(".");
      const secondsPart = parseInt(secondsParts[0]) || 0;
      const msPart =
        secondsParts.length > 1 ? parseInt(secondsParts[1]) / 1000 : 0;

      seconds = hoursPart * 3600 + minutesPart * 60 + secondsPart + msPart;
    } else {
      // Format: MM:SS or MM:SS.ms
      const minutesPart = parseInt(timeParts[0]) || 0;

      const secondsParts = timeParts[1].split(".");
      const secondsPart = parseInt(secondsParts[0]) || 0;
      const msPart =
        secondsParts.length > 1 ? parseInt(secondsParts[1]) / 1000 : 0;

      seconds = minutesPart * 60 + secondsPart + msPart;
    }

    // Clamp to valid range
    seconds = Math.max(
      0,
      Math.min(seconds, navigationInfo.fileDurationSeconds)
    );
    setSliderValue(seconds);

    // Find and select the appropriate chunk
    const targetSample = Math.floor(seconds * samplingFrequency);
    const targetChunk = navigationInfo.chunks.find(
      (chunk) => chunk.start <= targetSample && targetSample < chunk.end
    );

    if (targetChunk) {
      onChunkSelect(targetChunk.start, targetChunk.size);
    } else {
      onChunkSelect(targetSample, chunkSize);
    }
  };

  // Handle preset selection
  const handlePresetChange = (value: string) => {
    if (!navigationInfo) return;

    setSelectedPreset(value);
    const preset = timePresets.find((p) => p.value === value);
    if (preset) {
      setSliderValue(preset.seconds);

      // Find and select the appropriate chunk
      const targetSample = Math.floor(preset.seconds * samplingFrequency);
      const targetChunk = navigationInfo.chunks.find(
        (chunk) => chunk.start <= targetSample && targetSample < chunk.end
      );

      if (targetChunk) {
        onChunkSelect(targetChunk.start, targetChunk.size);
      } else {
        onChunkSelect(targetSample, chunkSize);
      }
    }
  };

  // Handle next/previous chunk navigation
  const handlePreviousChunk = () => {
    if (!navigationInfo || currentChunkIndex <= 0) return;

    const prevChunk = navigationInfo.chunks[currentChunkIndex - 1];
    onChunkSelect(prevChunk.start, prevChunk.size);
  };

  const handleNextChunk = () => {
    if (
      !navigationInfo ||
      currentChunkIndex >= navigationInfo.chunks.length - 1
    )
      return;

    const nextChunk = navigationInfo.chunks[currentChunkIndex + 1];
    onChunkSelect(nextChunk.start, nextChunk.size);
  };

  // Handle jump to start/end
  const handleJumpToStart = () => {
    if (!navigationInfo) return;

    const firstChunk = navigationInfo.chunks[0];
    onChunkSelect(firstChunk.start, firstChunk.size);
  };

  const handleJumpToEnd = () => {
    if (!navigationInfo) return;

    const lastChunk = navigationInfo.chunks[navigationInfo.chunks.length - 1];
    onChunkSelect(lastChunk.start, lastChunk.size);
  };

  if (loading && !navigationInfo) {
    return <div className="p-4">Loading navigation information...</div>;
  }

  if (error) {
    return (
      <div className="p-4 text-red-500">
        Error loading navigation: {error.message}
      </div>
    );
  }

  if (!navigationInfo) {
    return <div className="p-4">No navigation information available</div>;
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>EDF Navigator</span>
          <div className="text-sm font-normal">
            File duration: {formatTime(navigationInfo.fileDurationSeconds)}
          </div>
        </CardTitle>
        <CardDescription>
          Navigate through {navigationInfo.chunks.length} chunks (
          {formatSamples(navigationInfo.totalSamples)} samples)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Current position display */}
          <div className="flex items-center justify-between text-sm">
            <div>Current: {formatTime(sliderValue)}</div>
            <div>
              Chunk: {currentChunkIndex + 1} of {navigationInfo.chunks.length}
            </div>
            <div>
              Sample:{" "}
              {formatSamples(Math.floor(sliderValue * samplingFrequency))} of{" "}
              {formatSamples(navigationInfo.totalSamples)}
            </div>
          </div>

          {/* Timeline slider */}
          <div className="py-2">
            <Slider
              value={[sliderValue]}
              min={0}
              max={navigationInfo.fileDurationSeconds}
              step={0.1}
              onValueChange={handleSliderChange}
              onValueCommit={handleSliderCommit}
            />
          </div>

          {/* Navigation controls */}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleJumpToStart}
              title="Jump to start"
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviousChunk}
              disabled={currentChunkIndex <= 0}
              title="Previous chunk"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <div className="flex-1">
              <Select value={selectedPreset} onValueChange={handlePresetChange}>
                <SelectTrigger className="w-full">
                  <span>
                    {selectedPreset
                      ? timePresets.find((p) => p.value === selectedPreset)
                          ?.label
                      : "Jump to..."}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Quick Navigation</SelectLabel>
                    {timePresets.map((preset) => (
                      <SelectItem key={preset.value} value={preset.value}>
                        {preset.label} ({formatTime(preset.seconds)})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleNextChunk}
              disabled={currentChunkIndex >= navigationInfo.chunks.length - 1}
              title="Next chunk"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleJumpToEnd}
              title="Jump to end"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          {/* Time jump input */}
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 flex-shrink-0" />
            <Input
              placeholder="Jump to time (HH:MM:SS.ms)"
              value={jumpToTime}
              onChange={handleTimeInputChange}
              className="flex-1"
            />
            <Button variant="secondary" size="sm" onClick={handleTimeJump}>
              Go
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
