"use client";

import { useCallback } from "react";
import { useShallow } from "zustand/shallow";
import { useAppStore } from "@/store/appStore";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { useGroupStatistics } from "@/hooks/useGroupStatistics";
import { GroupAssignmentPanel } from "./GroupAssignmentPanel";
import { CompareBoxPlots } from "./CompareBoxPlots";
import { StatisticsResultsTable } from "./StatisticsResultsTable";
import type { ComparisonEntry } from "@/store/slices/comparisonSlice";

interface ChannelDataEntry {
  analysisId: string;
  ddaMatrix: Record<string, number[]>;
  windowIndices: number[];
}

interface CompareGroupStatsViewProps {
  entries: ComparisonEntry[];
  channelDataEntries: ChannelDataEntry[];
  commonChannels: string[];
}

const ALPHA = 0.05;
const PERMUTATION_ITERATIONS = 10000;
const CORRECTION_METHOD = "fdr" as const;

export function CompareGroupStatsView({
  entries,
  channelDataEntries,
  commonChannels,
}: CompareGroupStatsViewProps) {
  const {
    groupAssignments,
    groupLabels,
    setGroupAssignment,
    removeGroupAssignment,
    setGroupLabel,
    autoAssignGroups,
  } = useAppStore(
    useShallow((s) => ({
      groupAssignments: s.comparison.groupAssignments,
      groupLabels: s.comparison.groupLabels,
      setGroupAssignment: s.setGroupAssignment,
      removeGroupAssignment: s.removeGroupAssignment,
      setGroupLabel: s.setGroupLabel,
      autoAssignGroups: s.autoAssignGroups,
    })),
  );

  const clearAssignments = useCallback(() => {
    for (const entry of entries) {
      removeGroupAssignment(entry.analysisId);
    }
  }, [entries, removeGroupAssignment]);

  const { results, isValid, validationError } = useGroupStatistics({
    channelDataEntries,
    channels: commonChannels,
    groupAssignments,
    alpha: ALPHA,
    permutationIterations: PERMUTATION_ITERATIONS,
    correctionMethod: CORRECTION_METHOD,
  });

  if (entries.length < 4) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        Add at least 4 analyses to run group statistics (minimum 2 per group).
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <GroupAssignmentPanel
        entries={entries}
        groupAssignments={groupAssignments}
        groupLabels={groupLabels}
        onAssignGroup={setGroupAssignment}
        onRemoveAssignment={removeGroupAssignment}
        onSetGroupLabel={setGroupLabel}
        onAutoAssign={autoAssignGroups}
        onClearAssignments={clearAssignments}
      />

      {!isValid && validationError && (
        <Alert variant="warning">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{validationError}</AlertDescription>
        </Alert>
      )}

      {isValid && results.length > 0 && (
        <>
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Distribution Comparison</h4>
            <CompareBoxPlots
              results={results}
              groupALabel={groupLabels.A}
              groupBLabel={groupLabels.B}
              alpha={ALPHA}
            />
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium">
              Statistical Test Results
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Welch&apos;s t-test, FDR corrected, &alpha; = {ALPHA}
              </span>
            </h4>
            <StatisticsResultsTable
              results={results}
              groupALabel={groupLabels.A}
              groupBLabel={groupLabels.B}
              alpha={ALPHA}
            />
          </div>
        </>
      )}
    </div>
  );
}
