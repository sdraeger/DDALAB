import { useState, useCallback, useRef } from "react";
import { useEDFPlot } from "../contexts/EDFPlotContext";
import type { EEGData } from "../types/EEGData";

interface UseTimeWindowProps {
  filePath: string;
  sampleRate: number;
  chunkStart: number;
  chunkSize: number;
  plotData?: EEGData | null;
}

interface UseTimeWindowReturn {
  timeWindow: [number, number];
  absoluteTimeWindow: [number, number] | undefined;
  zoomLevel: number;
  showZoomSettings: boolean;
  setTimeWindow: (window: [number, number]) => void;
  setAbsoluteTimeWindow: (window: [number, number] | undefined) => void;
  setZoomLevel: (level: number) => void;
  setShowZoomSettings: (show: boolean) => void;
  handleTimeWindowChange: (newWindow: [number, number]) => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleReset: () => void;
  resetTimeWindow: (start: number) => void;
}

export const useTimeWindow = ({
  filePath,
  sampleRate,
  chunkStart,
  chunkSize,
  plotData,
}: UseTimeWindowProps): UseTimeWindowReturn => {
  const { getPlotState, updatePlotState } = useEDFPlot();

  const plotState = getPlotState(filePath);
  const [timeWindow, setTimeWindow] = useState<[number, number]>(
    plotState?.timeWindow || [0, 10]
  );
  const [absoluteTimeWindow, setAbsoluteTimeWindow] = useState<
    [number, number] | undefined
  >(plotState?.absoluteTimeWindow);
  const [zoomLevel, setZoomLevel] = useState(plotState?.zoomLevel || 1);
  const [showZoomSettings, setShowZoomSettings] = useState(false);
  const [shouldUpdateViewContext, setShouldUpdateViewContext] = useState(false);

  const timeWindowUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimeWindow = useCallback(
    (start: number) => {
      const chunkDurationSec = chunkSize / sampleRate;
      const newTimeWindow: [number, number] = [
        start,
        start + Math.min(10, chunkDurationSec),
      ];
      setTimeWindow(newTimeWindow);
      setZoomLevel(1);
    },
    [chunkSize, sampleRate]
  );

  const handleZoomIn = useCallback(() => {
    const currentDuration = timeWindow[1] - timeWindow[0];
    const newDuration = Math.max(0.1, currentDuration / 2);
    const center = (timeWindow[0] + timeWindow[1]) / 2;
    const newStart = Math.max(0, center - newDuration / 2);
    const chunkDurationSec = chunkSize / sampleRate;
    const newEnd = Math.min(chunkDurationSec, newStart + newDuration);

    const newWindow: [number, number] = [newStart, newEnd];
    setTimeWindow(newWindow);
    setZoomLevel(zoomLevel * 2);
    setShouldUpdateViewContext(true);
  }, [timeWindow, chunkSize, sampleRate, zoomLevel]);

  const handleZoomOut = useCallback(() => {
    const currentDuration = timeWindow[1] - timeWindow[0];
    const chunkDurationSec = chunkSize / sampleRate;
    const newDuration = Math.min(chunkDurationSec, currentDuration * 2);
    const center = (timeWindow[0] + timeWindow[1]) / 2;
    const newStart = Math.max(0, center - newDuration / 2);
    const newEnd = Math.min(chunkDurationSec, newStart + newDuration);

    const newWindow: [number, number] = [newStart, newEnd];
    setTimeWindow(newWindow);
    setZoomLevel(Math.max(0.1, zoomLevel / 2));
    setShouldUpdateViewContext(true);
  }, [timeWindow, chunkSize, sampleRate, zoomLevel]);

  const handleReset = useCallback(() => {
    const chunkDurationSec = chunkSize / sampleRate;
    const newWindow: [number, number] = [0, Math.min(10, chunkDurationSec)];
    setTimeWindow(newWindow);
    setZoomLevel(1);
    setShouldUpdateViewContext(true);
  }, [chunkSize, sampleRate]);

  const handleTimeWindowChange = useCallback(
    (newWindow: [number, number]) => {
      if (!plotData) {
        return; // Skip if no plot data is loaded
      }

      // Calculate chunk duration from plotData
      const chunkDuration = plotData.duration || chunkSize / sampleRate || 10;

      // Validate and clamp the new window to the chunk's duration
      const validatedWindow: [number, number] = [
        Math.max(0, newWindow[0]),
        Math.min(chunkDuration, newWindow[1]),
      ];

      setTimeWindow(validatedWindow);

      // Calculate absolute time window in seconds
      const absoluteChunkStart = chunkStart / sampleRate;
      setAbsoluteTimeWindow([
        absoluteChunkStart + validatedWindow[0],
        absoluteChunkStart + validatedWindow[1],
      ]);

      // Debounce context update
      if (timeWindowUpdateTimeoutRef.current) {
        clearTimeout(timeWindowUpdateTimeoutRef.current);
      }
      timeWindowUpdateTimeoutRef.current = setTimeout(() => {
        setShouldUpdateViewContext(true);
      }, 300);
    },
    [plotData, chunkSize, sampleRate, chunkStart]
  );

  return {
    timeWindow,
    absoluteTimeWindow,
    zoomLevel,
    showZoomSettings,
    setTimeWindow,
    setAbsoluteTimeWindow,
    setZoomLevel,
    setShowZoomSettings,
    handleTimeWindowChange,
    handleZoomIn,
    handleZoomOut,
    handleReset,
    resetTimeWindow,
  };
};
