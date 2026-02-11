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
import type { ChannelTestResult } from "@/hooks/useGroupStatistics";

interface StatisticsResultsTableProps {
  results: ChannelTestResult[];
  groupALabel: string;
  groupBLabel: string;
  alpha: number;
}

function formatPValue(p: number): string {
  if (!isFinite(p)) return "\u2014";
  if (p < 0.001) return "< 0.001";
  return p.toFixed(4);
}

function formatNum(v: number): string {
  if (!isFinite(v)) return "\u2014";
  if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(2);
  return v.toFixed(4);
}

function pValueColor(p: number): string {
  if (!isFinite(p)) return "text-muted-foreground";
  if (p < 0.001) return "text-red-600 dark:text-red-400";
  if (p < 0.01) return "text-orange-600 dark:text-orange-400";
  if (p < 0.05) return "text-yellow-600 dark:text-yellow-400";
  return "text-muted-foreground";
}

function significanceMarker(p: number, alpha: number): string {
  if (!isFinite(p) || p >= alpha) return "ns";
  if (p < 0.001) return "***";
  if (p < 0.01) return "**";
  return "*";
}

function effectSizeLabel(d: number): string {
  if (!isFinite(d)) return "";
  const abs = Math.abs(d);
  if (abs < 0.2) return "negligible";
  if (abs < 0.5) return "small";
  if (abs < 0.8) return "medium";
  return "large";
}

export function StatisticsResultsTable({
  results,
  groupALabel,
  groupBLabel,
  alpha,
}: StatisticsResultsTableProps) {
  const sorted = useMemo(
    () => [...results].sort((a, b) => a.correctedPValue - b.correctedPValue),
    [results],
  );

  if (sorted.length === 0) return null;

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-xs">Channel</TableHead>
            <TableHead className="text-xs text-right">
              {groupALabel} Mean (SD)
            </TableHead>
            <TableHead className="text-xs text-right">
              {groupBLabel} Mean (SD)
            </TableHead>
            <TableHead className="text-xs text-right">Cohen&apos;s d</TableHead>
            <TableHead className="text-xs text-right">t</TableHead>
            <TableHead className="text-xs text-right">df</TableHead>
            <TableHead className="text-xs text-right">p (raw)</TableHead>
            <TableHead className="text-xs text-right">p (adj)</TableHead>
            <TableHead className="text-xs text-center">Sig</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={r.channel}>
              <TableCell className="text-xs font-medium">{r.channel}</TableCell>
              <TableCell className="text-xs text-right font-mono text-muted-foreground">
                {formatNum(r.groupA.mean)} ({formatNum(r.groupA.std)})
              </TableCell>
              <TableCell className="text-xs text-right font-mono text-muted-foreground">
                {formatNum(r.groupB.mean)} ({formatNum(r.groupB.std)})
              </TableCell>
              <TableCell
                className="text-xs text-right font-mono text-muted-foreground"
                title={effectSizeLabel(r.cohensD)}
              >
                {formatNum(r.cohensD)}
              </TableCell>
              <TableCell className="text-xs text-right font-mono text-muted-foreground">
                {formatNum(r.tTest.tStatistic)}
              </TableCell>
              <TableCell className="text-xs text-right font-mono text-muted-foreground">
                {isFinite(r.tTest.degreesOfFreedom)
                  ? r.tTest.degreesOfFreedom.toFixed(1)
                  : "\u2014"}
              </TableCell>
              <TableCell className="text-xs text-right font-mono text-muted-foreground">
                {formatPValue(r.rawPValue)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-xs text-right font-mono font-semibold",
                  pValueColor(r.correctedPValue),
                )}
              >
                {formatPValue(r.correctedPValue)}
              </TableCell>
              <TableCell className="text-xs text-center font-semibold">
                {significanceMarker(r.correctedPValue, alpha)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
