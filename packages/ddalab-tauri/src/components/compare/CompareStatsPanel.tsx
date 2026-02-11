"use client";

import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface ChannelDataEntry {
  analysisId: string;
  ddaMatrix: Record<string, number[]>;
  windowIndices: number[];
}

interface CompareStatsPanelProps {
  channelDataA: ChannelDataEntry;
  channelDataB: ChannelDataEntry;
  selectedChannels: string[];
  labelA: string;
  labelB: string;
}

interface ChannelStats {
  channel: string;
  correlation: number;
  meanAbsDiff: number;
  maxAbsDiff: number;
  rmsDiff: number;
}

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;

  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }

  const den = Math.sqrt(denA * denB);
  if (den === 0) return NaN;
  return num / den;
}

function computeStats(a: number[], b: number[]): Omit<ChannelStats, "channel"> {
  const n = Math.min(a.length, b.length);
  if (n === 0) {
    return {
      correlation: NaN,
      meanAbsDiff: NaN,
      maxAbsDiff: NaN,
      rmsDiff: NaN,
    };
  }

  let sumAbsDiff = 0;
  let maxAbsDiff = 0;
  let sumSqDiff = 0;

  for (let i = 0; i < n; i++) {
    const diff = a[i] - b[i];
    const absDiff = Math.abs(diff);
    sumAbsDiff += absDiff;
    if (absDiff > maxAbsDiff) maxAbsDiff = absDiff;
    sumSqDiff += diff * diff;
  }

  return {
    correlation: pearsonCorrelation(a, b),
    meanAbsDiff: sumAbsDiff / n,
    maxAbsDiff,
    rmsDiff: Math.sqrt(sumSqDiff / n),
  };
}

function correlationColor(r: number): string {
  if (!isFinite(r)) return "text-muted-foreground";
  const abs = Math.abs(r);
  if (abs >= 0.9) return "text-green-600 dark:text-green-400";
  if (abs >= 0.7) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function formatNum(v: number): string {
  if (!isFinite(v)) return "—";
  if (Math.abs(v) < 0.001) return v.toExponential(2);
  return v.toFixed(4);
}

export function CompareStatsPanel({
  channelDataA,
  channelDataB,
  selectedChannels,
  labelA,
  labelB,
}: CompareStatsPanelProps) {
  const stats = useMemo(() => {
    const result: ChannelStats[] = [];
    for (const ch of selectedChannels) {
      const a = channelDataA.ddaMatrix[ch];
      const b = channelDataB.ddaMatrix[ch];
      if (!a || !b) continue;
      result.push({ channel: ch, ...computeStats(a, b) });
    }
    return result;
  }, [channelDataA, channelDataB, selectedChannels]);

  if (stats.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">
        Statistical Comparison: {labelA} vs {labelB}
      </h4>
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs">Channel</TableHead>
              <TableHead className="text-xs text-right">Correlation</TableHead>
              <TableHead className="text-xs text-right">Mean |Diff|</TableHead>
              <TableHead className="text-xs text-right">Max |Diff|</TableHead>
              <TableHead className="text-xs text-right">RMS Diff</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.map((s) => (
              <TableRow key={s.channel}>
                <TableCell className="text-xs font-medium">
                  {s.channel}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-xs text-right font-mono",
                    correlationColor(s.correlation),
                  )}
                >
                  {formatNum(s.correlation)}
                </TableCell>
                <TableCell className="text-xs text-right font-mono text-muted-foreground">
                  {formatNum(s.meanAbsDiff)}
                </TableCell>
                <TableCell className="text-xs text-right font-mono text-muted-foreground">
                  {formatNum(s.maxAbsDiff)}
                </TableCell>
                <TableCell className="text-xs text-right font-mono text-muted-foreground">
                  {formatNum(s.rmsDiff)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
