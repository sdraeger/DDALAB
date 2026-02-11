import { useMemo } from "react";
import {
  computeGroupStats,
  welchTTest,
  permutationTest,
  cohensD,
  fdrCorrection,
  bonferroniCorrection,
} from "@/utils/statistics";
import type {
  GroupDescriptiveStats,
  TTestResult,
  PermutationResult,
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
      // For each subject, reduce the time-series to a single mean value
      const valuesA: number[] = [];
      for (const entry of assignedA) {
        const series = entry.ddaMatrix[ch];
        if (series && series.length > 0) {
          const m = meanOfArray(series);
          if (isFinite(m)) valuesA.push(m);
        }
      }

      const valuesB: number[] = [];
      for (const entry of assignedB) {
        const series = entry.ddaMatrix[ch];
        if (series && series.length > 0) {
          const m = meanOfArray(series);
          if (isFinite(m)) valuesB.push(m);
        }
      }

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

      rawResults.push({
        channel: ch,
        groupA: groupAStats,
        groupB: groupBStats,
        tTest: tTestResult,
        permutation: permResult,
        cohensD: d,
        rawPValue: tTestResult.pValue,
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
