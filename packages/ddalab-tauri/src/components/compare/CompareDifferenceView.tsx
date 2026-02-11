"use client";

import { lazy, Suspense, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { COMPARE_COLORS } from "./CompareEntryList";
import { CompareStatsPanel } from "./CompareStatsPanel";
import type { ComparisonEntry } from "@/store/slices/comparisonSlice";

const DDAHeatmapPlot = lazy(() =>
  import("@/components/dda/DDAHeatmapPlot").then((mod) => ({
    default: mod.DDAHeatmapPlot,
  })),
);

interface ChannelDataEntry {
  analysisId: string;
  ddaMatrix: Record<string, number[]>;
  windowIndices: number[];
}

interface CompareDifferenceViewProps {
  entries: ComparisonEntry[];
  channelDataEntries: ChannelDataEntry[];
  selectedChannels: string[];
  scales: number[];
}

export function CompareDifferenceView({
  entries,
  channelDataEntries,
  selectedChannels,
  scales,
}: CompareDifferenceViewProps) {
  if (entries.length !== 2 || channelDataEntries.length !== 2) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        Select exactly 2 analyses to view their difference.
      </div>
    );
  }

  const dataA = channelDataEntries[0];
  const dataB = channelDataEntries[1];
  const entryA = entries.find((e) => e.analysisId === dataA.analysisId);
  const entryB = entries.find((e) => e.analysisId === dataB.analysisId);

  if (!entryA || !entryB) return null;

  return (
    <DifferenceContent
      dataA={dataA}
      dataB={dataB}
      entryA={entryA}
      entryB={entryB}
      selectedChannels={selectedChannels}
      scales={scales}
    />
  );
}

interface DifferenceContentProps {
  dataA: ChannelDataEntry;
  dataB: ChannelDataEntry;
  entryA: ComparisonEntry;
  entryB: ComparisonEntry;
  selectedChannels: string[];
  scales: number[];
}

function DifferenceContent({
  dataA,
  dataB,
  entryA,
  entryB,
  selectedChannels,
  scales,
}: DifferenceContentProps) {
  // Shared color range for A and B heatmaps
  const sharedRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const cde of [dataA, dataB]) {
      for (const ch of selectedChannels) {
        const values = cde.ddaMatrix[ch];
        if (!values) continue;
        for (const v of values) {
          if (isFinite(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
      }
    }
    if (!isFinite(min) || !isFinite(max)) return [0, 1] as [number, number];
    return [min, max] as [number, number];
  }, [dataA, dataB, selectedChannels]);

  // Difference matrix: A - B for each channel
  const diffMatrix = useMemo(() => {
    const result: Record<string, number[]> = {};
    for (const ch of selectedChannels) {
      const a = dataA.ddaMatrix[ch];
      const b = dataB.ddaMatrix[ch];
      if (!a || !b) continue;
      const n = Math.min(a.length, b.length);
      const diff = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        diff[i] = a[i] - b[i];
      }
      result[ch] = diff;
    }
    return result;
  }, [dataA, dataB, selectedChannels]);

  // Symmetric color range for difference heatmap centered at 0
  const diffRange = useMemo(() => {
    let maxAbs = 0;
    for (const ch of selectedChannels) {
      const values = diffMatrix[ch];
      if (!values) continue;
      for (const v of values) {
        if (isFinite(v)) {
          const abs = Math.abs(v);
          if (abs > maxAbs) maxAbs = abs;
        }
      }
    }
    if (maxAbs === 0) return [-1, 1] as [number, number];
    return [-maxAbs, maxAbs] as [number, number];
  }, [diffMatrix, selectedChannels]);

  const [colorRangeAB, setColorRangeAB] = useState(sharedRange);
  const [colorRangeDiff, setColorRangeDiff] = useState(diffRange);

  if (selectedChannels.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        Select channels to compare heatmaps
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Three-column heatmap layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Analysis A */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: COMPARE_COLORS[0] }}
            />
            <span className="text-xs font-medium truncate">{entryA.label}</span>
          </div>
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-lg" />}>
            <DDAHeatmapPlot
              variantId=""
              ddaMatrix={dataA.ddaMatrix}
              selectedChannels={selectedChannels}
              scales={scales}
              colorScheme="viridis"
              colorRange={colorRangeAB}
              autoScale={false}
              onColorRangeChange={setColorRangeAB}
              height={280}
            />
          </Suspense>
        </div>

        {/* Difference A − B */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium truncate text-muted-foreground">
              Difference (A &minus; B)
            </span>
          </div>
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-lg" />}>
            <DDAHeatmapPlot
              variantId=""
              ddaMatrix={diffMatrix}
              selectedChannels={selectedChannels}
              scales={scales}
              colorScheme="jet"
              colorRange={colorRangeDiff}
              autoScale={false}
              onColorRangeChange={setColorRangeDiff}
              height={280}
            />
          </Suspense>
        </div>

        {/* Analysis B */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: COMPARE_COLORS[1] }}
            />
            <span className="text-xs font-medium truncate">{entryB.label}</span>
          </div>
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-lg" />}>
            <DDAHeatmapPlot
              variantId=""
              ddaMatrix={dataB.ddaMatrix}
              selectedChannels={selectedChannels}
              scales={scales}
              colorScheme="viridis"
              colorRange={colorRangeAB}
              autoScale={false}
              onColorRangeChange={setColorRangeAB}
              height={280}
            />
          </Suspense>
        </div>
      </div>

      {/* Statistical comparison */}
      <CompareStatsPanel
        channelDataA={dataA}
        channelDataB={dataB}
        selectedChannels={selectedChannels}
        labelA={entryA.label}
        labelB={entryB.label}
      />
    </div>
  );
}
