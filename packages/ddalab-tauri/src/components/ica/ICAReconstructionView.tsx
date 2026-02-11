import { useRef, useEffect, useMemo, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ICAResult, ReconstructResponse } from "@/types/ica";

const MIN_WIDTH = 100;
const MIN_HEIGHT = 100;
const RESIZE_DEBOUNCE_MS = 100;

function getThemeColors() {
  const computedStyle = getComputedStyle(document.documentElement);
  return {
    textColor: computedStyle.getPropertyValue("--foreground").trim() || "#000",
    gridColor: computedStyle.getPropertyValue("--border").trim() || "#e5e7eb",
  };
}

function getBaseChartOptions(
  width: number,
  height: number,
): Pick<uPlot.Options, "width" | "height" | "cursor" | "scales"> {
  return {
    width: Math.max(width, MIN_WIDTH),
    height: Math.max(height, MIN_HEIGHT),
    cursor: {
      show: true,
      drag: { x: true, y: false },
    },
    scales: {
      x: { time: false },
      y: { auto: true },
    },
  };
}

function useContainerSize(
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const newWidth = Math.floor(rect.width);
      const newHeight = Math.floor(rect.height);

      if (
        Math.abs(newWidth - lastSizeRef.current.width) > 5 ||
        Math.abs(newHeight - lastSizeRef.current.height) > 5
      ) {
        lastSizeRef.current = { width: newWidth, height: newHeight };
        setSize({ width: newWidth, height: newHeight });
      }
    };

    updateSize();

    const observer = new ResizeObserver(() => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(updateSize, RESIZE_DEBOUNCE_MS);
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [containerRef]);

  return size;
}

interface ICAReconstructionViewProps {
  result: ICAResult;
  reconstructedData: ReconstructResponse;
  sampleRate: number;
}

export function ICAReconstructionView({
  result,
  reconstructedData,
  sampleRate,
}: ICAReconstructionViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const size = useContainerSize(containerRef);
  const [selectedChannelIdx, setSelectedChannelIdx] = useState(0);

  const channelNames = useMemo(
    () => reconstructedData.channels.map((c) => c.name),
    [reconstructedData],
  );

  // Compute original signal for the selected channel from mixing_matrix * sources
  const plotData = useMemo(() => {
    const cleanedChannel = reconstructedData.channels[selectedChannelIdx];
    if (!cleanedChannel) return null;

    const numSamples = cleanedChannel.samples.length;
    const timeArray = new Float64Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      timeArray[i] = i / sampleRate;
    }

    // Reconstruct original from mixing_matrix * all source signals
    const mixingRow = result.results.mixing_matrix[selectedChannelIdx];
    const originalArray = new Float64Array(numSamples);
    if (mixingRow) {
      for (
        let compIdx = 0;
        compIdx < result.results.components.length;
        compIdx++
      ) {
        const weight = mixingRow[compIdx] ?? 0;
        const timeSeries = result.results.components[compIdx]?.time_series;
        if (!timeSeries) continue;
        const len = Math.min(numSamples, timeSeries.length);
        for (let i = 0; i < len; i++) {
          originalArray[i] += weight * timeSeries[i];
        }
      }
    }

    const cleanedArray = new Float64Array(cleanedChannel.samples);

    return [timeArray, originalArray, cleanedArray] as [
      Float64Array,
      Float64Array,
      Float64Array,
    ];
  }, [result, reconstructedData, selectedChannelIdx, sampleRate]);

  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      !plotData ||
      size.width < MIN_WIDTH ||
      size.height < MIN_HEIGHT
    )
      return;

    const { textColor, gridColor } = getThemeColors();
    const channelName =
      channelNames[selectedChannelIdx] || `Ch${selectedChannelIdx}`;

    const opts: uPlot.Options = {
      ...getBaseChartOptions(size.width, size.height),
      title: `${channelName} — Before vs After Artifact Removal`,
      axes: [
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          label: "Time (s)",
          labelSize: 14,
          size: 50,
          gap: 4,
        },
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          label: "Amplitude",
          labelSize: 14,
          size: 60,
          gap: 4,
        },
      ],
      series: [
        {},
        {
          label: "Original",
          stroke: "rgba(59, 130, 246, 0.5)",
          width: 1,
        },
        {
          label: "Cleaned",
          stroke: "#10b981",
          width: 1.5,
        },
      ],
    };

    if (uplotRef.current) {
      uplotRef.current.destroy();
    }

    uplotRef.current = new uPlot(
      opts,
      plotData as uPlot.AlignedData,
      container,
    );

    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, [plotData, size.width, size.height, channelNames, selectedChannelIdx]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="px-2 flex items-center gap-3 flex-shrink-0">
        <p className="text-xs text-muted-foreground">
          Comparing original (blue) vs cleaned (green) signal after removing
          marked artifact components.
        </p>
        <Select
          value={String(selectedChannelIdx)}
          onValueChange={(v) => setSelectedChannelIdx(Number(v))}
        >
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue placeholder="Select channel" />
          </SelectTrigger>
          <SelectContent>
            {channelNames.map((name, idx) => (
              <SelectItem key={idx} value={String(idx)} className="text-xs">
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden pb-1"
        style={{ contain: "layout size" }}
      />
    </div>
  );
}

export default ICAReconstructionView;
