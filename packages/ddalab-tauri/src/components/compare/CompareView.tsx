"use client";

import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useAppStore } from "@/store/appStore";
import { Separator } from "@/components/ui/separator";
import { GitCompareArrows } from "lucide-react";
import {
  useAnalysisGroups,
  useComparisonMetadata,
  useComparisonChannelData,
} from "@/hooks/useComparisonAnalysis";
import { tauriBackendService } from "@/services/tauriBackendService";
import { CompareEmptyState } from "./CompareEmptyState";
import { CompareEntryList } from "./CompareEntryList";
import { CompareToolbar } from "./CompareToolbar";
import { CompareSummaryTable } from "./CompareSummaryTable";
import { CompareOverlayPlot } from "./CompareOverlayPlot";
import { CompareSideBySideView } from "./CompareSideBySideView";
import { CompareAnalysisPicker } from "./CompareAnalysisPicker";
import { CompareGroupPicker } from "./CompareGroupPicker";
import type { ComparisonEntry } from "@/store/slices/comparisonSlice";

export function CompareView() {
  const {
    entries,
    groupId,
    activeVariantId,
    commonChannels,
    selectedChannels,
    viewMode,
    setComparisonFromGroup,
    addComparisonEntry,
    removeComparisonEntry,
    setComparisonVariant,
    setComparisonChannels,
    setComparisonViewMode,
  } = useAppStore(
    useShallow((s) => ({
      entries: s.comparison.entries,
      groupId: s.comparison.groupId,
      activeVariantId: s.comparison.activeVariantId,
      commonChannels: s.comparison.commonChannels,
      selectedChannels: s.comparison.selectedChannels,
      viewMode: s.comparison.viewMode,
      setComparisonFromGroup: s.setComparisonFromGroup,
      addComparisonEntry: s.addComparisonEntry,
      removeComparisonEntry: s.removeComparisonEntry,
      setComparisonVariant: s.setComparisonVariant,
      setComparisonChannels: s.setComparisonChannels,
      setComparisonViewMode: s.setComparisonViewMode,
    })),
  );

  const [showPicker, setShowPicker] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);

  const { data: groups } = useAnalysisGroups();
  const hasGroups = (groups?.length ?? 0) > 0;

  const analysisIds = useMemo(
    () => entries.map((e) => e.analysisId),
    [entries],
  );
  const { data: metadata } = useComparisonMetadata(analysisIds);

  // Fetch channel data for overlay and side-by-side views
  const channelDataResults = useComparisonChannelData(
    entries,
    activeVariantId,
    viewMode !== "summary" ? selectedChannels : [],
  );

  const channelDataEntries = useMemo(() => {
    return channelDataResults.filter((r) => r.data).map((r) => r.data!);
  }, [channelDataResults]);

  // Derive available variants from entries
  const availableVariants = useMemo(() => {
    const variantSet = new Map<string, string>();
    for (const entry of entries) {
      for (const vid of entry.variantIds) {
        if (!variantSet.has(vid)) {
          variantSet.set(vid, vid);
        }
      }
    }
    // Also check metadata for display names
    if (metadata) {
      for (const m of metadata) {
        if (m.variantName && !variantSet.has(m.variantName)) {
          variantSet.set(m.variantName, m.variantDisplayName || m.variantName);
        }
      }
    }
    return Array.from(variantSet.entries()).map(([id, name]) => ({
      id,
      name,
    }));
  }, [entries, metadata]);

  // Derive scales from metadata parameters
  const scales = useMemo(() => {
    if (!metadata || metadata.length === 0)
      return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const params = metadata[0]?.parameters as Record<string, unknown>;
    if (Array.isArray(params?.delay_list)) {
      return params.delay_list as number[];
    }
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  }, [metadata]);

  const existingIds = useMemo(
    () => new Set(entries.map((e) => e.analysisId)),
    [entries],
  );

  const handleAddEntries = useCallback(
    (newEntries: ComparisonEntry[]) => {
      for (const entry of newEntries) {
        addComparisonEntry(entry);
      }
    },
    [addComparisonEntry],
  );

  const handleLoadGroup = useCallback(
    async (groupIdToLoad: string) => {
      try {
        const result =
          await tauriBackendService.getAnalysisGroup(groupIdToLoad);
        if (!result) return;

        const metadataBatch =
          await tauriBackendService.getAnalysesMetadataBatch(result.memberIds);

        const groupEntries: ComparisonEntry[] = metadataBatch.map((m) => ({
          analysisId: m.id,
          label: m.name ?? m.filePath.split("/").pop() ?? m.id,
          filePath: m.filePath,
          channels: m.channels ?? [],
          variantIds: [m.variantName],
          createdAt: m.timestamp,
        }));

        setComparisonFromGroup(groupIdToLoad, groupEntries);
        setShowGroupPicker(false);
      } catch (err) {
        console.error("[CompareView] Failed to load group:", err);
      }
    },
    [setComparisonFromGroup],
  );

  // Find group name if loaded from a group
  const groupName = useMemo(() => {
    if (!groupId || !groups) return null;
    const g = groups.find((g) => g.id === groupId);
    return g?.name ?? null;
  }, [groupId, groups]);

  const isEmpty = entries.length === 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-4 max-w-7xl mx-auto">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <GitCompareArrows className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-semibold">Compare Results</h2>
          </div>
          <p className="text-sm text-muted-foreground ml-9">
            Compare DDA analyses across multiple subjects or conditions
          </p>
        </div>

        <Separator />

        {isEmpty ? (
          <CompareEmptyState
            onLoadGroup={() => setShowGroupPicker(true)}
            onPickFromHistory={() => setShowPicker(true)}
            hasGroups={hasGroups}
          />
        ) : (
          <div className="flex gap-6">
            {/* Left sidebar: entry list */}
            <div className="w-56 shrink-0 border rounded-lg overflow-hidden">
              <CompareEntryList
                entries={entries}
                groupName={groupName}
                onRemoveEntry={removeComparisonEntry}
                onAddFromHistory={() => setShowPicker(true)}
                onLoadGroup={() => setShowGroupPicker(true)}
                hasGroups={hasGroups}
              />
            </div>

            {/* Main content */}
            <div className="flex-1 space-y-4 min-w-0">
              <CompareToolbar
                viewMode={viewMode}
                onViewModeChange={setComparisonViewMode}
                activeVariantId={activeVariantId}
                onVariantChange={setComparisonVariant}
                availableVariants={availableVariants}
                commonChannels={commonChannels}
                selectedChannels={selectedChannels}
                onChannelsChange={setComparisonChannels}
              />

              {/* Summary view */}
              <div
                style={{
                  display: viewMode === "summary" ? "block" : "none",
                }}
              >
                <CompareSummaryTable
                  entries={entries}
                  metadata={metadata ?? []}
                />
              </div>

              {/* Overlay view */}
              <div
                style={{
                  display: viewMode === "overlay" ? "block" : "none",
                }}
              >
                {selectedChannels.length > 0 ? (
                  <div className="space-y-4">
                    {selectedChannels.map((ch) => (
                      <CompareOverlayPlot
                        key={ch}
                        entries={entries}
                        channelDataEntries={channelDataEntries}
                        channel={ch}
                        height={300}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                    Select channels to see overlay plots
                  </div>
                )}
              </div>

              {/* Side-by-side view */}
              <div
                style={{
                  display: viewMode === "sideBySide" ? "block" : "none",
                }}
              >
                <CompareSideBySideView
                  entries={entries}
                  channelDataEntries={channelDataEntries}
                  selectedChannels={selectedChannels}
                  scales={scales}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CompareAnalysisPicker
        open={showPicker}
        onOpenChange={setShowPicker}
        existingEntryIds={existingIds}
        onAddEntries={handleAddEntries}
      />
      <CompareGroupPicker
        open={showGroupPicker}
        onOpenChange={setShowGroupPicker}
        onSelectGroup={handleLoadGroup}
      />
    </div>
  );
}
