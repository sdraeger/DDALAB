import { useRef, useEffect, useMemo, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { ICAComponent } from "@/types/ica";

/** Minimum dimensions to avoid uPlot errors */
const MIN_WIDTH = 100;
const MIN_HEIGHT = 100;
const RESIZE_DEBOUNCE_MS = 100;

/** Get theme colors from CSS variables */
function getThemeColors() {
  const computedStyle = getComputedStyle(document.documentElement);
  return {
    textColor: computedStyle.getPropertyValue("--foreground").trim() || "#000",
    gridColor: computedStyle.getPropertyValue("--border").trim() || "#e5e7eb",
  };
}

/** Common chart options builder */
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

/** Hook to get container size with debounced ResizeObserver */
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

      // Only update if changed significantly (> 5px)
      if (
        Math.abs(newWidth - lastSizeRef.current.width) > 5 ||
        Math.abs(newHeight - lastSizeRef.current.height) > 5
      ) {
        lastSizeRef.current = { width: newWidth, height: newHeight };
        setSize({ width: newWidth, height: newHeight });
      }
    };

    // Initial measurement
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

// ============================================================================
// Time Series Visualization
// ============================================================================

interface TimeSeriesProps {
  component: ICAComponent;
  sampleRate: number;
}

export function ICATimeSeries({ component, sampleRate }: TimeSeriesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const size = useContainerSize(containerRef);

  const plotData = useMemo(() => {
    const timeSeries = component.time_series;
    const numSamples = timeSeries.length;

    const timeArray = new Float64Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      timeArray[i] = i / sampleRate;
    }

    const valueArray = new Float64Array(timeSeries);
    return [timeArray, valueArray] as [Float64Array, Float64Array];
  }, [component, sampleRate]);

  // Create/update chart
  useEffect(() => {
    const container = containerRef.current;
    if (!container || size.width < MIN_WIDTH || size.height < MIN_HEIGHT)
      return;

    const { textColor, gridColor } = getThemeColors();

    const opts: uPlot.Options = {
      ...getBaseChartOptions(size.width, size.height),
      title: `IC ${component.component_id + 1} - Source Signal`,
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
          label: "IC",
          stroke: "#3b82f6",
          width: 1,
        },
      ],
    };

    // Clean up previous instance
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
  }, [plotData, component.component_id, size.width, size.height]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <p className="text-xs text-muted-foreground px-2 flex-shrink-0">
        Time series of the independent source signal. Each IC represents a
        statistically independent signal contributing to the measured channels.
      </p>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden pb-1"
        style={{ contain: "layout size" }}
      />
    </div>
  );
}

// ============================================================================
// Topography Visualization
// ============================================================================

interface TopographyProps {
  component: ICAComponent;
  channelNames: string[];
}

export function ICATopography({ component, channelNames }: TopographyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const size = useContainerSize(containerRef);

  const { plotData, sortedChannelInfo } = useMemo(() => {
    const spatialMap = component.spatial_map;
    const numChannels = spatialMap.length;

    const channelIndices = new Float64Array(numChannels);
    for (let i = 0; i < numChannels; i++) {
      channelIndices[i] = i;
    }

    const weights = new Float64Array(spatialMap);

    const sorted = spatialMap
      .map((weight, idx) => ({
        name: channelNames[idx] || `Ch${idx}`,
        weight,
        absWeight: Math.abs(weight),
      }))
      .sort((a, b) => b.absWeight - a.absWeight);

    return {
      plotData: {
        data: [channelIndices, weights] as [Float64Array, Float64Array],
        labels: channelNames,
      },
      sortedChannelInfo: sorted,
    };
  }, [component, channelNames]);

  // Create/update chart
  useEffect(() => {
    const container = containerRef.current;
    if (!container || size.width < MIN_WIDTH || size.height < MIN_HEIGHT)
      return;

    const { textColor, gridColor } = getThemeColors();

    const opts: uPlot.Options = {
      ...getBaseChartOptions(size.width, size.height),
      title: `IC ${component.component_id + 1} - Channel Weights`,
      cursor: {
        show: true,
        points: { show: false },
      },
      axes: [
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          label: "Channel",
          labelSize: 14,
          size: 50,
          gap: 4,
          values: (u, vals) =>
            vals.map((v) => plotData.labels[Math.round(v)] || ""),
        },
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          label: "Weight",
          labelSize: 14,
          size: 60,
          gap: 4,
        },
      ],
      series: [
        {},
        {
          label: "Weight",
          stroke: "#8b5cf6",
          width: 2,
          paths: (u, seriesIdx, idx0, idx1) => {
            const data = u.data[seriesIdx];
            const barWidth = 0.8;
            let d = "";

            for (let i = idx0; i <= idx1; i++) {
              const x = u.data[0][i];
              const y = data[i];
              if (y == null) continue;

              const xPos = u.valToPos(x, "x", true);
              const yPos = u.valToPos(y, "y", true);
              const y0Pos = u.valToPos(0, "y", true);
              const barHalfWidth =
                ((u.bbox.width / u.data[0].length) * barWidth) / 2;

              d += `M${xPos - barHalfWidth},${y0Pos} L${xPos - barHalfWidth},${yPos} L${xPos + barHalfWidth},${yPos} L${xPos + barHalfWidth},${y0Pos} Z `;
            }

            const path = new Path2D(d);
            return { stroke: path, fill: path };
          },
          fill: "rgba(139, 92, 246, 0.3)",
        },
      ],
    };

    // Clean up previous instance
    if (uplotRef.current) {
      uplotRef.current.destroy();
    }

    uplotRef.current = new uPlot(
      opts,
      plotData.data as uPlot.AlignedData,
      container,
    );

    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, [plotData, component.component_id, size.width, size.height]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="px-2 space-y-2 flex-shrink-0">
        <p className="text-xs text-muted-foreground">
          Shows how strongly this component appears in each channel. Higher
          values indicate more influence.
        </p>
        <div className="text-xs">
          <span className="font-medium text-muted-foreground">
            Top channels:{" "}
          </span>
          {sortedChannelInfo.slice(0, 5).map((info, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-muted rounded mr-1"
            >
              <span className="font-medium">{info.name}</span>
              <span className="text-muted-foreground">
                ({info.weight > 0 ? "+" : ""}
                {info.weight.toFixed(2)})
              </span>
            </span>
          ))}
        </div>
      </div>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden pb-1"
        style={{ contain: "layout size" }}
      />
    </div>
  );
}

// ============================================================================
// Spectrum Visualization
// ============================================================================

interface SpectrumProps {
  component: ICAComponent;
}

export function ICASpectrum({ component }: SpectrumProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const size = useContainerSize(containerRef);

  const plotData = useMemo(() => {
    if (!component.power_spectrum) return null;

    const maxFreq = 100;
    const freqs = component.power_spectrum.frequencies;
    const power = component.power_spectrum.power;

    let cutoffIdx = freqs.length;
    for (let i = 0; i < freqs.length; i++) {
      if (freqs[i] > maxFreq) {
        cutoffIdx = i;
        break;
      }
    }

    const freqArray = new Float64Array(freqs.slice(0, cutoffIdx));
    const powerArray = new Float64Array(power.slice(0, cutoffIdx));

    return [freqArray, powerArray] as [Float64Array, Float64Array];
  }, [component]);

  // Create/update chart
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

    const opts: uPlot.Options = {
      ...getBaseChartOptions(size.width, size.height),
      title: `IC ${component.component_id + 1} - Power Spectrum`,
      axes: [
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          label: "Frequency (Hz)",
          labelSize: 14,
          size: 50,
          gap: 4,
        },
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          label: "Power (dB)",
          labelSize: 14,
          size: 60,
          gap: 4,
        },
      ],
      series: [
        {},
        {
          label: "Power",
          stroke: "#10b981",
          width: 1,
          fill: "rgba(16, 185, 129, 0.1)",
        },
      ],
    };

    // Clean up previous instance
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
  }, [plotData, component.component_id, size.width, size.height]);

  if (!component.power_spectrum) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        No spectrum data available
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <p className="text-xs text-muted-foreground px-2 flex-shrink-0">
        Power spectrum showing frequency content. Useful for identifying
        artifacts like 50/60 Hz line noise or alpha rhythms.
      </p>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden pb-1"
        style={{ contain: "layout size" }}
      />
    </div>
  );
}
