"use client";

import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { COMPARE_COLORS } from "./CompareEntryList";
import type { ComparisonEntry } from "@/store/slices/comparisonSlice";

interface ChannelDataEntry {
  analysisId: string;
  ddaMatrix: Record<string, number[]>;
  windowIndices: number[];
}

interface CompareOverlayPlotProps {
  entries: ComparisonEntry[];
  channelDataEntries: ChannelDataEntry[];
  channel: string;
  height?: number;
}

export function CompareOverlayPlot({
  entries,
  channelDataEntries,
  channel,
  height = 300,
}: CompareOverlayPlotProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  const { data, series } = useMemo(() => {
    if (channelDataEntries.length === 0) {
      return { data: [[]] as uPlot.AlignedData, series: [] as uPlot.Series[] };
    }

    // Find the longest x-axis
    let maxLen = 0;
    const channelDataSets: Array<{ label: string; values: number[] }> = [];

    for (let i = 0; i < channelDataEntries.length; i++) {
      const cde = channelDataEntries[i];
      const entry = entries.find((e) => e.analysisId === cde.analysisId);
      const values = cde.ddaMatrix[channel];
      if (!values) continue;

      if (values.length > maxLen) maxLen = values.length;
      channelDataSets.push({
        label: entry?.label ?? `Analysis ${i + 1}`,
        values,
      });
    }

    if (maxLen === 0) {
      return { data: [[]] as uPlot.AlignedData, series: [] as uPlot.Series[] };
    }

    // Build aligned data: [xValues, ...seriesValues]
    const xValues = new Float64Array(maxLen);
    for (let i = 0; i < maxLen; i++) xValues[i] = i;

    const alignedData: uPlot.AlignedData = [xValues];
    const seriesConfig: uPlot.Series[] = [{}]; // x-axis series

    for (let i = 0; i < channelDataSets.length; i++) {
      const { label, values } = channelDataSets[i];
      const arr = new Float64Array(maxLen);
      for (let j = 0; j < maxLen; j++) {
        arr[j] = j < values.length ? values[j] : NaN;
      }
      alignedData.push(arr);
      seriesConfig.push({
        label,
        stroke: COMPARE_COLORS[i % COMPARE_COLORS.length],
        width: 2,
        points: { show: false },
      });
    }

    return { data: alignedData, series: seriesConfig };
  }, [entries, channelDataEntries, channel]);

  useEffect(() => {
    if (!containerRef.current || series.length <= 1) return;

    const container = containerRef.current;
    const width = container.clientWidth || 600;

    const opts: uPlot.Options = {
      width,
      height,
      series,
      scales: {
        x: { time: false },
        y: {},
      },
      axes: [
        {
          label: "Window Index",
          labelSize: 24,
          size: 40,
          font: "11px system-ui",
        },
        {
          label: "DDA Value",
          labelSize: 60,
          size: 60,
          font: "11px system-ui",
        },
      ],
      cursor: {
        show: true,
        drag: { x: true, y: false },
      },
      legend: {
        show: true,
        live: true,
      },
    };

    plotRef.current?.destroy();
    plotRef.current = new uPlot(opts, data, container);

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && plotRef.current) {
        plotRef.current.setSize({
          width: entry.contentRect.width,
          height,
        });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [data, series, height]);

  if (series.length <= 1) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground border rounded-lg">
        No data available for channel &quot;{channel}&quot;
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium text-muted-foreground">{channel}</h4>
      <div ref={containerRef} className="border rounded-lg overflow-hidden" />
    </div>
  );
}
