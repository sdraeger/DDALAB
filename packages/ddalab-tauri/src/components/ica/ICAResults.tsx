import React, { useState, useMemo, useRef, useEffect } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { ICAResult, ICAComponent } from "@/types/ica";

interface ICAResultsProps {
  result: ICAResult;
  onComponentSelect?: (componentId: number) => void;
  markedComponents?: Set<number>;
  onToggleMarked?: (componentId: number) => void;
}

export function ICAResults({
  result,
  onComponentSelect,
  markedComponents = new Set(),
  onToggleMarked,
}: ICAResultsProps) {
  const [selectedComponent, setSelectedComponent] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"time" | "spectrum" | "topography">(
    "time",
  );

  const selectedData = useMemo(() => {
    const comp = result.results.components[selectedComponent];
    if (!comp) return null;
    return comp;
  }, [result, selectedComponent]);

  const handleComponentClick = (componentId: number) => {
    setSelectedComponent(componentId);
    onComponentSelect?.(componentId);
  };

  return (
    <div className="flex flex-col h-full gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">ICA Results</h2>
          <p className="text-sm text-muted-foreground">
            {result.results.components.length} independent components extracted
            from {result.results.channel_names.length} input channels
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={`px-3 py-1 rounded text-sm ${
              viewMode === "time"
                ? "bg-primary text-primary-foreground"
                : "bg-muted"
            }`}
            onClick={() => setViewMode("time")}
          >
            Time Series
          </button>
          <button
            className={`px-3 py-1 rounded text-sm ${
              viewMode === "topography"
                ? "bg-primary text-primary-foreground"
                : "bg-muted"
            }`}
            onClick={() => setViewMode("topography")}
          >
            Topography
          </button>
          <button
            className={`px-3 py-1 rounded text-sm ${
              viewMode === "spectrum"
                ? "bg-primary text-primary-foreground"
                : "bg-muted"
            }`}
            onClick={() => setViewMode("spectrum")}
          >
            Spectrum
          </button>
        </div>
      </div>

      {/* Component Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
        {result.results.components.map((comp) => (
          <ComponentCard
            key={comp.component_id}
            component={comp}
            channelNames={result.results.channel_names}
            isSelected={selectedComponent === comp.component_id}
            isMarked={markedComponents.has(comp.component_id)}
            onClick={() => handleComponentClick(comp.component_id)}
            onToggleMarked={() => onToggleMarked?.(comp.component_id)}
          />
        ))}
      </div>

      {/* Selected Component Visualization */}
      {selectedData && (
        <div className="flex-1 min-h-[300px]">
          {viewMode === "time" ? (
            <ComponentTimeSeries
              component={selectedData}
              sampleRate={result.results.sample_rate}
            />
          ) : viewMode === "topography" ? (
            <ComponentTopography
              component={selectedData}
              channelNames={result.results.channel_names}
            />
          ) : (
            <ComponentSpectrum component={selectedData} />
          )}
        </div>
      )}
    </div>
  );
}

interface ComponentCardProps {
  component: ICAComponent;
  channelNames: string[];
  isSelected: boolean;
  isMarked: boolean;
  onClick: () => void;
  onToggleMarked: () => void;
}

function ComponentCard({
  component,
  channelNames,
  isSelected,
  isMarked,
  onClick,
  onToggleMarked,
}: ComponentCardProps) {
  const kurtosisClass =
    Math.abs(component.kurtosis) > 3
      ? "text-orange-500"
      : Math.abs(component.kurtosis) > 1
        ? "text-yellow-500"
        : "text-green-500";

  // Find top 2 channels for this component
  const topChannels = useMemo(() => {
    const channelWeights = component.spatial_map.map((weight, idx) => ({
      name: channelNames[idx] || `Ch${idx}`,
      weight: Math.abs(weight),
    }));
    channelWeights.sort((a, b) => b.weight - a.weight);
    return channelWeights.slice(0, 2);
  }, [component, channelNames]);

  return (
    <div
      className={`p-2 rounded border cursor-pointer transition-colors ${
        isSelected
          ? "border-primary bg-primary/10"
          : "border-border hover:border-primary/50"
      } ${isMarked ? "bg-red-500/10" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm">
          IC {component.component_id + 1}
        </span>
        <button
          className={`w-4 h-4 rounded-full border ${
            isMarked ? "bg-red-500 border-red-500" : "border-muted-foreground"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMarked();
          }}
          title={isMarked ? "Unmark artifact" : "Mark as artifact"}
        />
      </div>
      <div className="text-xs space-y-0.5">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Kurt:</span>
          <span className={kurtosisClass}>{component.kurtosis.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Var:</span>
          <span>{component.variance_explained.toFixed(1)}%</span>
        </div>
        <div
          className="text-[10px] text-muted-foreground mt-1 truncate"
          title={topChannels.map((c) => c.name).join(", ")}
        >
          {topChannels.map((c) => c.name).join(", ")}
        </div>
      </div>
    </div>
  );
}

interface ComponentTimeSeriesProps {
  component: ICAComponent;
  sampleRate: number;
}

function ComponentTimeSeries({
  component,
  sampleRate,
}: ComponentTimeSeriesProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Prepare data for uPlot
  const plotData = useMemo(() => {
    const timeSeries = component.time_series;
    const numSamples = timeSeries.length;

    // Create time array
    const timeArray = new Float64Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      timeArray[i] = i / sampleRate;
    }

    // Convert values to Float64Array for better performance
    const valueArray = new Float64Array(timeSeries);

    return [timeArray, valueArray] as [Float64Array, Float64Array];
  }, [component, sampleRate]);

  useEffect(() => {
    if (!plotRef.current) return;

    const container = plotRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 300;

    // Get CSS variables for theming
    const computedStyle = getComputedStyle(document.documentElement);
    const textColor =
      computedStyle.getPropertyValue("--foreground").trim() || "#000";
    const gridColor =
      computedStyle.getPropertyValue("--border").trim() || "#e5e7eb";

    const opts: uPlot.Options = {
      width,
      height,
      title: `Independent Component ${component.component_id + 1} - Source Signal`,
      cursor: {
        show: true,
        drag: { x: true, y: false },
      },
      scales: {
        x: { time: false },
        y: { auto: true },
      },
      axes: [
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          label: "Time (s)",
          labelSize: 12,
          size: 40,
        },
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          label: "Amplitude (arbitrary units)",
          labelSize: 12,
          size: 60,
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

    // Cleanup previous instance
    if (uplotRef.current) {
      uplotRef.current.destroy();
    }

    uplotRef.current = new uPlot(
      opts,
      plotData as uPlot.AlignedData,
      container,
    );

    // Setup resize observer with safeguards against infinite loops
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
    }

    let lastWidth = width;
    let lastHeight = height;

    resizeObserverRef.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = Math.floor(entry.contentRect.width);
        const newHeight = Math.floor(entry.contentRect.height);

        // Only resize if dimensions actually changed significantly (>5px difference)
        if (
          uplotRef.current &&
          newWidth > 0 &&
          newHeight > 0 &&
          (Math.abs(newWidth - lastWidth) > 5 ||
            Math.abs(newHeight - lastHeight) > 5)
        ) {
          lastWidth = newWidth;
          lastHeight = newHeight;
          uplotRef.current.setSize({
            width: newWidth,
            height: newHeight,
          });
        }
      }
    });

    resizeObserverRef.current.observe(container);

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, [plotData, component.component_id]);

  return (
    <div className="h-full w-full flex flex-col gap-2">
      <p className="text-sm text-muted-foreground px-2">
        This shows the time series of the independent source signal extracted by
        ICA. Each IC represents a statistically independent signal that
        contributes to the measured channels.
      </p>
      <div className="flex-1 min-h-0" ref={plotRef} />
    </div>
  );
}

interface ComponentTopographyProps {
  component: ICAComponent;
  channelNames: string[];
}

function ComponentTopography({
  component,
  channelNames,
}: ComponentTopographyProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Prepare data for bar chart showing spatial distribution
  const plotData = useMemo(() => {
    const spatialMap = component.spatial_map;
    const numChannels = spatialMap.length;

    // Create channel index array
    const channelIndices = new Float64Array(numChannels);
    for (let i = 0; i < numChannels; i++) {
      channelIndices[i] = i;
    }

    // Convert weights to Float64Array
    const weights = new Float64Array(spatialMap);

    return {
      data: [channelIndices, weights] as [Float64Array, Float64Array],
      labels: channelNames,
    };
  }, [component, channelNames]);

  // Sort channels by absolute weight for easier interpretation
  const sortedChannelInfo = useMemo(() => {
    return component.spatial_map
      .map((weight, idx) => ({
        name: channelNames[idx] || `Ch${idx}`,
        weight,
        absWeight: Math.abs(weight),
      }))
      .sort((a, b) => b.absWeight - a.absWeight);
  }, [component, channelNames]);

  useEffect(() => {
    if (!plotRef.current) return;

    const container = plotRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 300;

    // Get CSS variables for theming
    const computedStyle = getComputedStyle(document.documentElement);
    const textColor =
      computedStyle.getPropertyValue("--foreground").trim() || "#000";
    const gridColor =
      computedStyle.getPropertyValue("--border").trim() || "#e5e7eb";

    const opts: uPlot.Options = {
      width,
      height,
      title: `IC ${component.component_id + 1} - Channel Contributions (Spatial Map)`,
      cursor: {
        show: true,
        points: { show: false },
      },
      scales: {
        x: { time: false },
        y: { auto: true },
      },
      axes: [
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          label: "Channel Index",
          labelSize: 12,
          size: 40,
          values: (u, vals) =>
            vals.map((v) => plotData.labels[Math.round(v)] || ""),
        },
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          label: "Weight (mixing coefficient)",
          labelSize: 12,
          size: 60,
        },
      ],
      series: [
        {},
        {
          label: "Weight",
          stroke: "#8b5cf6",
          width: 2,
          paths: (u, seriesIdx, idx0, idx1) => {
            // Draw bars instead of lines
            const data = u.data[seriesIdx];
            const s = u.series[seriesIdx];
            const xScale = u.scales.x;
            const yScale = u.scales.y;

            if (!xScale || !yScale) return null;

            const barWidth = 0.8;
            let d = "";

            for (let i = idx0; i <= idx1; i++) {
              const x = u.data[0][i];
              const y = data[i];

              const xPos = u.valToPos(x, "x", true);
              const yPos = u.valToPos(y, "y", true);
              const y0Pos = u.valToPos(0, "y", true);

              const barHalfWidth =
                ((u.bbox.width / u.data[0].length) * barWidth) / 2;

              // Draw rectangle for bar
              d += `M${xPos - barHalfWidth},${y0Pos} L${xPos - barHalfWidth},${yPos} L${xPos + barHalfWidth},${yPos} L${xPos + barHalfWidth},${y0Pos} Z `;
            }

            return new Path2D(d);
          },
          fill: "rgba(139, 92, 246, 0.3)",
        },
      ],
    };

    // Cleanup previous instance
    if (uplotRef.current) {
      uplotRef.current.destroy();
    }

    uplotRef.current = new uPlot(
      opts,
      plotData.data as uPlot.AlignedData,
      container,
    );

    // Setup resize observer with safeguards against infinite loops
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
    }

    let lastWidth = width;
    let lastHeight = height;

    resizeObserverRef.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = Math.floor(entry.contentRect.width);
        const newHeight = Math.floor(entry.contentRect.height);

        // Only resize if dimensions actually changed significantly (>5px difference)
        if (
          uplotRef.current &&
          newWidth > 0 &&
          newHeight > 0 &&
          (Math.abs(newWidth - lastWidth) > 5 ||
            Math.abs(newHeight - lastHeight) > 5)
        ) {
          lastWidth = newWidth;
          lastHeight = newHeight;
          uplotRef.current.setSize({
            width: newWidth,
            height: newHeight,
          });
        }
      }
    });

    resizeObserverRef.current.observe(container);

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, [plotData, component.component_id]);

  return (
    <div className="h-full w-full flex flex-col gap-2">
      <div className="px-2 space-y-2">
        <p className="text-sm text-muted-foreground">
          This shows how strongly this independent component appears in each
          input channel. Higher absolute values indicate this IC has more
          influence on that channel.
        </p>
        <div className="text-xs space-y-1">
          <div className="font-medium">Top contributing channels:</div>
          <div className="flex flex-wrap gap-2">
            {sortedChannelInfo.slice(0, 5).map((info, idx) => (
              <div
                key={idx}
                className="px-2 py-1 bg-muted rounded text-xs"
                title={`Weight: ${info.weight.toFixed(3)}`}
              >
                <span className="font-medium">{info.name}</span>
                <span className="text-muted-foreground ml-1">
                  ({info.weight > 0 ? "+" : ""}
                  {info.weight.toFixed(2)})
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0" ref={plotRef} />
    </div>
  );
}

interface ComponentSpectrumProps {
  component: ICAComponent;
}

function ComponentSpectrum({ component }: ComponentSpectrumProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Prepare data for uPlot
  const plotData = useMemo(() => {
    if (!component.power_spectrum) return null;

    // Limit to frequencies up to 100 Hz for typical EEG
    const maxFreq = 100;
    const freqs = component.power_spectrum.frequencies;
    const power = component.power_spectrum.power;

    // Find cutoff index
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

  useEffect(() => {
    if (!plotRef.current || !plotData) return;

    const container = plotRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 300;

    // Get CSS variables for theming
    const computedStyle = getComputedStyle(document.documentElement);
    const textColor =
      computedStyle.getPropertyValue("--foreground").trim() || "#000";
    const gridColor =
      computedStyle.getPropertyValue("--border").trim() || "#e5e7eb";

    const opts: uPlot.Options = {
      width,
      height,
      title: `IC ${component.component_id + 1} - Power Spectrum`,
      cursor: {
        show: true,
        drag: { x: true, y: false },
      },
      scales: {
        x: { time: false },
        y: { auto: true },
      },
      axes: [
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          label: "Frequency (Hz)",
          labelSize: 12,
          size: 40,
        },
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          label: "Power (dB)",
          labelSize: 12,
          size: 60,
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

    // Cleanup previous instance
    if (uplotRef.current) {
      uplotRef.current.destroy();
    }

    uplotRef.current = new uPlot(
      opts,
      plotData as uPlot.AlignedData,
      container,
    );

    // Setup resize observer with safeguards against infinite loops
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
    }

    let lastWidth = width;
    let lastHeight = height;

    resizeObserverRef.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = Math.floor(entry.contentRect.width);
        const newHeight = Math.floor(entry.contentRect.height);

        // Only resize if dimensions actually changed significantly (>5px difference)
        if (
          uplotRef.current &&
          newWidth > 0 &&
          newHeight > 0 &&
          (Math.abs(newWidth - lastWidth) > 5 ||
            Math.abs(newHeight - lastHeight) > 5)
        ) {
          lastWidth = newWidth;
          lastHeight = newHeight;
          uplotRef.current.setSize({
            width: newWidth,
            height: newHeight,
          });
        }
      }
    });

    resizeObserverRef.current.observe(container);

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, [plotData, component.component_id]);

  if (!component.power_spectrum) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        No spectrum data available
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col gap-2">
      <p className="text-sm text-muted-foreground px-2">
        Power spectrum of the independent component, showing frequency content.
        Useful for identifying rhythmic artifacts (e.g., 50/60 Hz line noise,
        alpha rhythms).
      </p>
      <div className="flex-1 min-h-0" ref={plotRef} />
    </div>
  );
}

export default ICAResults;
