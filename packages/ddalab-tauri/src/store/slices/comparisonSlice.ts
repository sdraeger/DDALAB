/**
 * Comparison Slice
 *
 * Manages state for comparing multiple DDA analysis results
 * across subjects, files, or conditions.
 */

import type { ImmerStateCreator } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface ComparisonEntry {
  analysisId: string;
  label: string;
  filePath: string;
  channels: string[];
  variantIds: string[];
  createdAt: string;
}

export type ComparisonViewMode =
  | "summary"
  | "overlay"
  | "sideBySide"
  | "difference"
  | "statistics";

export interface ComparisonState {
  groupId: string | null;
  entries: ComparisonEntry[];
  activeVariantId: string;
  commonChannels: string[];
  selectedChannels: string[];
  viewMode: ComparisonViewMode;
  groupAssignments: Record<string, "A" | "B">;
  groupLabels: { A: string; B: string };
}

// ============================================================================
// Actions
// ============================================================================

export interface ComparisonActions {
  setComparisonFromGroup: (groupId: string, entries: ComparisonEntry[]) => void;
  setComparisonEntries: (entries: ComparisonEntry[]) => void;
  addComparisonEntry: (entry: ComparisonEntry) => void;
  removeComparisonEntry: (analysisId: string) => void;
  setComparisonVariant: (variantId: string) => void;
  setComparisonChannels: (channels: string[]) => void;
  setComparisonViewMode: (mode: ComparisonViewMode) => void;
  setGroupAssignment: (analysisId: string, group: "A" | "B") => void;
  removeGroupAssignment: (analysisId: string) => void;
  setGroupLabel: (group: "A" | "B", label: string) => void;
  autoAssignGroups: () => void;
  clearComparison: () => void;
}

// ============================================================================
// Slice
// ============================================================================

export interface ComparisonSlice extends ComparisonActions {
  comparison: ComparisonState;
}

export const defaultComparisonState: ComparisonState = {
  groupId: null,
  entries: [],
  activeVariantId: "single_timeseries",
  commonChannels: [],
  selectedChannels: [],
  viewMode: "summary",
  groupAssignments: {},
  groupLabels: { A: "Group A", B: "Group B" },
};

function computeCommonChannels(entries: ComparisonEntry[]): string[] {
  if (entries.length === 0) return [];
  if (entries.length === 1) return [...entries[0].channels];

  const first = new Set(entries[0].channels);
  for (let i = 1; i < entries.length; i++) {
    const current = new Set(entries[i].channels);
    for (const ch of first) {
      if (!current.has(ch)) first.delete(ch);
    }
  }
  return Array.from(first).sort();
}

export const createComparisonSlice: ImmerStateCreator<ComparisonSlice> = (
  set,
) => ({
  comparison: { ...defaultComparisonState },

  setComparisonFromGroup: (groupId, entries) => {
    set((state) => {
      state.comparison.groupId = groupId;
      state.comparison.entries = entries;
      state.comparison.commonChannels = computeCommonChannels(entries);
      state.comparison.selectedChannels = computeCommonChannels(entries);
    });
  },

  setComparisonEntries: (entries) => {
    set((state) => {
      state.comparison.groupId = null;
      state.comparison.entries = entries;
      state.comparison.commonChannels = computeCommonChannels(entries);
      state.comparison.selectedChannels = computeCommonChannels(entries);
    });
  },

  addComparisonEntry: (entry) => {
    set((state) => {
      if (
        state.comparison.entries.some((e) => e.analysisId === entry.analysisId)
      )
        return;
      state.comparison.entries.push(entry);
      state.comparison.commonChannels = computeCommonChannels(
        state.comparison.entries,
      );
      state.comparison.selectedChannels = computeCommonChannels(
        state.comparison.entries,
      );
    });
  },

  removeComparisonEntry: (analysisId) => {
    set((state) => {
      state.comparison.entries = state.comparison.entries.filter(
        (e) => e.analysisId !== analysisId,
      );
      state.comparison.commonChannels = computeCommonChannels(
        state.comparison.entries,
      );
      state.comparison.selectedChannels =
        state.comparison.selectedChannels.filter((ch) =>
          state.comparison.commonChannels.includes(ch),
        );
      delete state.comparison.groupAssignments[analysisId];
    });
  },

  setComparisonVariant: (variantId) => {
    set((state) => {
      state.comparison.activeVariantId = variantId;
    });
  },

  setComparisonChannels: (channels) => {
    set((state) => {
      state.comparison.selectedChannels = channels;
    });
  },

  setComparisonViewMode: (mode) => {
    set((state) => {
      state.comparison.viewMode = mode;
    });
  },

  setGroupAssignment: (analysisId, group) => {
    set((state) => {
      state.comparison.groupAssignments[analysisId] = group;
    });
  },

  removeGroupAssignment: (analysisId) => {
    set((state) => {
      delete state.comparison.groupAssignments[analysisId];
    });
  },

  setGroupLabel: (group, label) => {
    set((state) => {
      state.comparison.groupLabels[group] = label;
    });
  },

  autoAssignGroups: () => {
    set((state) => {
      const assignments: Record<string, "A" | "B"> = {};
      const half = Math.ceil(state.comparison.entries.length / 2);
      state.comparison.entries.forEach((e, i) => {
        assignments[e.analysisId] = i < half ? "A" : "B";
      });
      state.comparison.groupAssignments = assignments;
    });
  },

  clearComparison: () => {
    set((state) => {
      state.comparison = { ...defaultComparisonState };
    });
  },
});
