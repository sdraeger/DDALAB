"use client";

import { lazy, Suspense, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { COMPARE_COLORS } from "./CompareEntryList";
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

interface CompareSideBySideViewProps {
  entries: ComparisonEntry[];
  channelDataEntries: ChannelDataEntry[];
  selectedChannels: string[];
  scales: number[];
}

export function CompareSideBySideView({
  entries,
  channelDataEntries,
  selectedChannels,
  scales,
}: CompareSideBySideViewProps) {
  // Shared color range across all heatmaps for fair comparison
  const sharedRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const cde of channelDataEntries) {
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
  }, [channelDataEntries, selectedChannels]);

  const [colorRange, setColorRange] = useState(sharedRange);

  // Grid columns: responsive
  const gridCols =
    entries.length <= 2
      ? "grid-cols-1 md:grid-cols-2"
      : entries.length <= 4
        ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-2"
        : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";

  if (channelDataEntries.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        Select channels to compare heatmaps
      </div>
    );
  }

  return (
    <div className={`grid ${gridCols} gap-4`}>
      {channelDataEntries.map((cde, i) => {
        const entry = entries.find((e) => e.analysisId === cde.analysisId);
        if (!entry) return null;

        return (
          <div key={entry.analysisId} className="space-y-2">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{
                  backgroundColor: COMPARE_COLORS[i % COMPARE_COLORS.length],
                }}
              />
              <span className="text-xs font-medium truncate">
                {entry.label}
              </span>
            </div>
            <Suspense
              fallback={<Skeleton className="h-64 w-full rounded-lg" />}
            >
              <DDAHeatmapPlot
                variantId=""
                ddaMatrix={cde.ddaMatrix}
                selectedChannels={selectedChannels}
                scales={scales}
                colorScheme="viridis"
                colorRange={colorRange}
                autoScale={false}
                onColorRangeChange={setColorRange}
                height={280}
              />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
}
