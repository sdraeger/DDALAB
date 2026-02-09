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

export type ComparisonViewMode = "summary" | "overlay" | "sideBySide";

export interface ComparisonState {
  groupId: string | null;
  entries: ComparisonEntry[];
  activeVariantId: string;
  commonChannels: string[];
  selectedChannels: string[];
  viewMode: ComparisonViewMode;
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

  clearComparison: () => {
    set((state) => {
      state.comparison = { ...defaultComparisonState };
    });
  },
});
