import { useMemo } from "react";
import {
  computeGroupStats,
  welchTTest,
  permutationTest,
  cohensD,
  fdrCorrection,
  bonferroniCorrection,
  clusterPermutationTest,
} from "@/utils/statistics";
import type {
  GroupDescriptiveStats,
  TTestResult,
  PermutationResult,
  ClusterPermutationResult,
} from "@/utils/statistics";

interface ChannelDataEntry {
  analysisId: string;
  ddaMatrix: Record<string, number[]>;
  windowIndices: number[];
}

export interface ChannelTestResult {
  channel: string;
  groupA: GroupDescriptiveStats;
  groupB: GroupDescriptiveStats;
  tTest: TTestResult;
  permutation: PermutationResult;
  cohensD: number;
  cluster: ClusterPermutationResult;
  timeResolved: {
    windowCount: number;
    significantWindowCount: number;
    clusterCount: number;
    minClusterP: number;
  };
  rawPValue: number;
  correctedPValue: number;
  significant: boolean;
}

interface UseGroupStatisticsParams {
  channelDataEntries: ChannelDataEntry[];
  channels: string[];
  groupAssignments: Record<string, "A" | "B">;
  alpha: number;
  permutationIterations: number;
  correctionMethod: "fdr" | "bonferroni" | "none";
}

interface UseGroupStatisticsResult {
  results: ChannelTestResult[];
  isValid: boolean;
  validationError: string | null;
}

function meanOfArray(values: number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

function truncateToCommonLength(series: number[][]): number[][] {
  if (series.length === 0) return [];
  const minLen = series.reduce(
    (min, s) => Math.min(min, s.length),
    Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(minLen) || minLen < 2) return [];
  return series.map((s) => s.slice(0, minLen));
}

export function useGroupStatistics({
  channelDataEntries,
  channels,
  groupAssignments,
  alpha,
  permutationIterations,
  correctionMethod,
}: UseGroupStatisticsParams): UseGroupStatisticsResult {
  return useMemo(() => {
    const assignedA = channelDataEntries.filter(
      (e) => groupAssignments[e.analysisId] === "A",
    );
    const assignedB = channelDataEntries.filter(
      (e) => groupAssignments[e.analysisId] === "B",
    );

    if (assignedA.length < 2 || assignedB.length < 2) {
      const unassignedCount =
        channelDataEntries.length - assignedA.length - assignedB.length;
      let error: string;
      if (unassignedCount > 0) {
        error = `${unassignedCount} entries not yet assigned to a group`;
      } else if (assignedA.length < 2) {
        error = `Group A needs at least 2 entries (has ${assignedA.length})`;
      } else {
        error = `Group B needs at least 2 entries (has ${assignedB.length})`;
      }
      return { results: [], isValid: false, validationError: error };
    }

    const rawResults: Omit<
      ChannelTestResult,
      "correctedPValue" | "significant"
    >[] = [];

    for (const ch of channels) {
      const seriesA: number[][] = [];
      for (const entry of assignedA) {
        const series = entry.ddaMatrix[ch];
        if (series && series.length > 0) {
          seriesA.push(series);
        }
      }

      const seriesB: number[][] = [];
      for (const entry of assignedB) {
        const series = entry.ddaMatrix[ch];
        if (series && series.length > 0) {
          seriesB.push(series);
        }
      }

      if (seriesA.length < 2 || seriesB.length < 2) continue;

      const alignedA = truncateToCommonLength(seriesA);
      const alignedB = truncateToCommonLength(seriesB);
      if (alignedA.length < 2 || alignedB.length < 2) continue;

      const valuesA = alignedA
        .map((s) => meanOfArray(s))
        .filter((v) => Number.isFinite(v));
      const valuesB = alignedB
        .map((s) => meanOfArray(s))
        .filter((v) => Number.isFinite(v));
      if (valuesA.length < 2 || valuesB.length < 2) continue;

      const groupAStats = computeGroupStats(valuesA);
      const groupBStats = computeGroupStats(valuesB);
      const tTestResult = welchTTest(valuesA, valuesB);
      const permResult = permutationTest(
        valuesA,
        valuesB,
        permutationIterations,
      );
      const d = cohensD(valuesA, valuesB);
      const clusterIterations = Math.min(permutationIterations, 5000);
      const clusterResult = clusterPermutationTest(alignedA, alignedB, {
        iterations: clusterIterations,
        alpha,
      });
      const significantWindowCount = clusterResult.significantMask.filter(
        (isSig) => isSig,
      ).length;

      rawResults.push({
        channel: ch,
        groupA: groupAStats,
        groupB: groupBStats,
        tTest: tTestResult,
        permutation: permResult,
        cohensD: d,
        cluster: clusterResult,
        timeResolved: {
          windowCount: clusterResult.significantMask.length,
          significantWindowCount,
          clusterCount: clusterResult.clusters.length,
          minClusterP: clusterResult.minClusterP,
        },
        rawPValue: clusterResult.minClusterP,
      });
    }

    // Apply multiple comparisons correction
    const rawPValues = rawResults.map((r) => r.rawPValue);
    let corrected: number[];

    switch (correctionMethod) {
      case "fdr":
        corrected = fdrCorrection(rawPValues);
        break;
      case "bonferroni":
        corrected = bonferroniCorrection(rawPValues);
        break;
      default:
        corrected = rawPValues;
    }

    const results: ChannelTestResult[] = rawResults.map((r, i) => ({
      ...r,
      correctedPValue: corrected[i],
      significant: corrected[i] < alpha,
    }));

    return { results, isValid: true, validationError: null };
  }, [
    channelDataEntries,
    channels,
    groupAssignments,
    alpha,
    permutationIterations,
    correctionMethod,
  ]);
}
