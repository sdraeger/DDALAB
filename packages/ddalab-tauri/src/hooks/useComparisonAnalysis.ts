"use client";

import { useQuery, useQueries } from "@tanstack/react-query";
import { tauriBackendService } from "@/services/tauriBackendService";
import type { AnalysisGroupResponse } from "@/services/tauriBackendService";

export const comparisonKeys = {
  all: ["comparison"] as const,
  groups: () => [...comparisonKeys.all, "groups"] as const,
  group: (groupId: string) =>
    [...comparisonKeys.all, "group", groupId] as const,
  metadata: (analysisIds: string[]) =>
    [...comparisonKeys.all, "metadata", ...analysisIds.sort()] as const,
};

export function useAnalysisGroups(limit?: number) {
  return useQuery({
    queryKey: comparisonKeys.groups(),
    queryFn: () => tauriBackendService.listAnalysisGroups(limit),
    staleTime: 30_000,
  });
}

export function useAnalysisGroup(groupId: string | null) {
  return useQuery({
    queryKey: comparisonKeys.group(groupId ?? ""),
    queryFn: () => tauriBackendService.getAnalysisGroup(groupId!),
    enabled: !!groupId,
    staleTime: 60_000,
  });
}

export function useComparisonMetadata(analysisIds: string[]) {
  return useQuery({
    queryKey: comparisonKeys.metadata(analysisIds),
    queryFn: () => tauriBackendService.getAnalysesMetadataBatch(analysisIds),
    enabled: analysisIds.length > 0,
    staleTime: 60_000,
  });
}

export function useComparisonChannelData(
  entries: Array<{ analysisId: string }>,
  variantId: string,
  channels: string[],
) {
  return useQueries({
    queries: entries.map((entry) => ({
      queryKey: [
        "dda",
        "channelData",
        entry.analysisId,
        variantId,
        channels.sort().join(","),
      ],
      queryFn: async () => {
        const result = await tauriBackendService.getDDAChannelData(
          entry.analysisId,
          variantId,
          channels,
        );
        return { analysisId: entry.analysisId, ...result };
      },
      enabled: channels.length > 0,
      staleTime: 5 * 60_000,
    })),
  });
}

export type { AnalysisGroupResponse };
