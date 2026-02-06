import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tauriBackendService } from "@/services/tauriBackendService";
import { DDAAnalysisRequest, DDAResult, DDAResultMetadata } from "@/types/api";
import { useAppStore } from "@/store/appStore";
import { TauriService, NotificationType } from "@/services/tauriService";

/**
 * Query key factory for DDA analysis operations
 */
export const ddaKeys = {
  all: ["dda"] as const,
  history: () => [...ddaKeys.all, "history"] as const,
  result: (resultId: string) => [...ddaKeys.all, "result", resultId] as const,
  resultFromHistory: (resultId: string) =>
    [...ddaKeys.result(resultId), "from-history"] as const,
  channelData: (analysisId: string, variantId: string, channels: string[]) =>
    [
      ...ddaKeys.all,
      "channelData",
      analysisId,
      variantId,
      channels.sort().join(","),
    ] as const,
  status: (resultId: string) => [...ddaKeys.all, "status", resultId] as const,
};

/**
 * Hook to submit DDA analysis with mutation
 *
 * @returns Mutation object for submitting DDA analysis
 *
 * @example
 * const submitAnalysis = useSubmitDDAAnalysis();
 *
 * const handleSubmit = () => {
 *   submitAnalysis.mutate(request, {
 *     onSuccess: (result) => {
 *       console.log('Analysis submitted:', result.id);
 *     }
 *   });
 * };
 */
export function useSubmitDDAAnalysis() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: DDAAnalysisRequest) => {
      return tauriBackendService.submitDDAAnalysis(request);
    },
    onSuccess: async (result) => {
      // Add the new result to the history cache immediately
      // No need to invalidate - the result is complete from the mutation response
      queryClient.setQueryData<DDAResult[]>(ddaKeys.history(), (old) => {
        return old ? [result, ...old] : [result];
      });

      // Unlock the config tab by setting DDA running state to false
      // This ensures the config tab unlocks even if the component is unmounted
      useAppStore.getState().setDDARunning(false);

      // Send native notification for successful completion
      if (TauriService.isTauri()) {
        try {
          const variantCount = result.results?.variants?.length || 1;
          await TauriService.createNotification(
            "DDA Analysis Complete",
            `Analysis completed successfully with ${variantCount} variant(s)`,
            NotificationType.Success,
            "view-analysis",
            { analysisId: result.id },
          );
        } catch (err) {
          console.error(
            "[NOTIFICATIONS] Failed to create success notification:",
            err,
          );
        }
      }
    },
    onError: async (error: Error) => {
      // Unlock the config tab on error as well
      useAppStore.getState().setDDARunning(false);

      // Create a user-friendly error message
      const errorMessage = error.message || "";
      let userMessage = "Analysis failed. Please try again.";

      if (
        errorMessage.includes("network") ||
        errorMessage.includes("fetch") ||
        errorMessage.includes("ECONNREFUSED")
      ) {
        userMessage =
          "Network connection issue. Please check your connection and try again.";
      } else if (
        errorMessage.includes("timeout") ||
        errorMessage.includes("timed out")
      ) {
        userMessage =
          "Analysis timed out. Try with fewer channels or a shorter time range.";
      } else if (
        errorMessage.includes("500") ||
        errorMessage.includes("server")
      ) {
        userMessage = "Server error. Please try again in a moment.";
      } else if (errorMessage.length > 0 && errorMessage.length < 100) {
        // Use the original message if it's short and readable
        userMessage = errorMessage;
      }

      // Send native notification for error
      if (TauriService.isTauri()) {
        try {
          await TauriService.createNotification(
            "DDA Analysis Failed",
            userMessage,
            NotificationType.Error,
          );
        } catch (err) {
          console.error(
            "[NOTIFICATIONS] Failed to create error notification:",
            err,
          );
        }
      }
    },
    retry: 1, // Retry once on failure
  });
}

/**
 * Hook to fetch DDA analysis result by ID
 *
 * @param resultId - Analysis result ID
 * @param enabled - Whether to enable the query (default: true)
 * @returns Query result with analysis data
 *
 * @example
 * const { data: result, isLoading } = useDDAResult('dda_123');
 */
export function useDDAResult(resultId: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ddaKeys.result(resultId),
    queryFn: () => tauriBackendService.getDDAResult(resultId),
    enabled: enabled && !!resultId,
    staleTime: Infinity, // Results never change once completed
    gcTime: 15 * 60 * 1000, // 15 minutes (was 1 hour) - DDA results are smaller than EEG data
    retry: 2,
  });
}

/**
 * Hook to fetch DDA analysis history metadata (lightweight, no full results)
 *
 * This returns minimal DDAResult-compatible objects without fetching full analysis data.
 * Full analysis data should be loaded on-demand using useAnalysisFromHistory when selected.
 *
 * @param enabled - Whether to enable the query (default: true)
 * @returns Query result with analysis history (lightweight metadata only)
 */
export function useDDAHistory(enabled: boolean = true) {
  return useQuery({
    queryKey: ddaKeys.history(),
    queryFn: async () => {
      // Only fetch metadata - full results loaded on-demand via useAnalysisFromHistory
      const historyEntries = await tauriBackendService.listDDAHistory(20);

      if (historyEntries.length === 0) {
        return [];
      }

      // Convert history entries to minimal DDAResult objects for compatibility
      // The sidebar only needs: id, name, file_path, created_at, channels count, variants count
      // Full data will be loaded via useAnalysisFromHistory when user selects one
      return historyEntries.map((entry) => {
        // Create placeholder channel names just for length counting in the UI
        const placeholderChannels = Array.from(
          { length: entry.channelsCount || 0 },
          (_, i) => `ch${i}`,
        );
        // Create placeholder variants for count display
        const placeholderVariants = Array.from(
          { length: entry.variantsCount || 1 },
          (_, i) => `variant${i}`,
        );

        return {
          id: entry.id,
          name: entry.name,
          file_path: entry.filePath, // Backend uses camelCase
          channels: placeholderChannels,
          parameters: {
            file_path: entry.filePath,
            channels: placeholderChannels,
            start_time: 0,
            end_time: 0,
            variants: placeholderVariants,
            delay_list: [],
          },
          results: {
            window_indices: [],
            variants: [],
          },
          status: "completed" as const,
          created_at: entry.createdAt, // Backend uses camelCase
        };
      }) as DDAResult[];
    },
    enabled,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch DDA metadata from history by ID (fast, instant transfer).
 *
 * PROGRESSIVE LOADING: Returns a DDAResult-compatible object immediately with metadata.
 * The `results.variants[].dda_matrix` will be empty - use useDDAChannelData() to fetch
 * the actual channel data on-demand.
 *
 * @param analysisId - Analysis ID to load from history
 * @param enabled - Whether to enable the query (default: false, must opt-in)
 * @returns Query result with DDAResult-compatible object (metadata only, no large arrays)
 *
 * @example
 * const { data: analysis, isLoading } = useAnalysisFromHistory('abc-123', true);
 * // analysis.results.variants[].dda_matrix is empty
 * // Use useDDAChannelData to fetch actual channel data for rendering
 */
export function useAnalysisFromHistory(
  analysisId: string | null,
  enabled: boolean = false,
) {
  return useQuery({
    queryKey: ddaKeys.resultFromHistory(analysisId || ""),
    queryFn: async (): Promise<DDAResult | null> => {
      const metadata = await tauriBackendService.getDDAFromHistory(analysisId!);
      if (!metadata) return null;

      // Convert metadata to DDAResult-compatible object
      // The dda_matrix fields are empty - components should use useDDAChannelData
      return {
        id: metadata.id,
        name: metadata.name,
        file_path: metadata.file_path,
        channels: metadata.channels,
        parameters: metadata.parameters as DDAAnalysisRequest,
        results: {
          window_indices: metadata.window_indices,
          variants: metadata.variants.map((v) => ({
            variant_id: v.variant_id,
            variant_name: v.variant_name,
            dda_matrix: {}, // Empty - fetch via useDDAChannelData
            exponents: v.exponents,
            quality_metrics: v.quality_metrics,
            network_motifs: v.has_network_motifs ? undefined : undefined, // Placeholder
          })),
        },
        status: metadata.status,
        created_at: metadata.created_at,
        completed_at: metadata.completed_at,
        error_message: metadata.error_message,
        source: metadata.source,
      };
    },
    enabled: enabled && !!analysisId,
    staleTime: Infinity, // Analysis metadata never changes once saved
    gcTime: 15 * 60 * 1000, // 15 minutes
    retry: 2,
  });
}

/**
 * Hook to fetch specific channel data from a cached DDA result.
 *
 * PROGRESSIVE LOADING: Fetches only the requested channels' dda_matrix.
 * The result must have been loaded first via useAnalysisFromHistory() to populate
 * the worker cache.
 *
 * @param analysisId - Analysis ID (must be in worker cache)
 * @param variantId - Variant ID to fetch data for
 * @param channels - Channel names to fetch data for
 * @param enabled - Whether to enable the query
 * @returns Query result with channel data
 *
 * @example
 * const { data: metadata } = useAnalysisFromHistory(analysisId, true);
 * const { data: channelData, isLoading } = useDDAChannelData(
 *   analysisId,
 *   'single_timeseries',
 *   ['Fp1', 'Fp2', 'F3', 'F4'],
 *   !!metadata // Only fetch when metadata is loaded
 * );
 */
export function useDDAChannelData(
  analysisId: string | undefined,
  variantId: string | undefined,
  channels: string[],
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ddaKeys.channelData(analysisId || "", variantId || "", channels),
    queryFn: () =>
      tauriBackendService.getDDAChannelData(analysisId!, variantId!, channels),
    enabled: enabled && !!analysisId && !!variantId && channels.length > 0,
    staleTime: Infinity, // Channel data never changes
    gcTime: 5 * 60 * 1000, // 5 minutes - shorter since this is derived data
    retry: 1,
  });
}

/**
 * Hook to save DDA analysis to history
 *
 * @returns Mutation object for saving analysis
 *
 * @example
 * const saveToHistory = useSaveDDAToHistory();
 *
 * saveToHistory.mutate(result, {
 *   onSuccess: () => console.log('Saved to history')
 * });
 */
export function useSaveDDAToHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (result: DDAResult) => {
      return tauriBackendService.saveDDAToHistory(result);
    },
    onMutate: async (newAnalysis) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ddaKeys.history() });

      // Get current history
      const previousHistory = queryClient.getQueryData<DDAResult[]>(
        ddaKeys.history(),
      );

      // Optimistically update history by adding the new analysis at the beginning
      if (previousHistory) {
        queryClient.setQueryData<DDAResult[]>(ddaKeys.history(), (old) => {
          if (!old) return [newAnalysis];
          // Add to beginning if not already present
          const exists = old.some((a) => a.id === newAnalysis.id);
          if (exists) return old;
          return [newAnalysis, ...old];
        });
      }

      return { previousHistory };
    },
    onError: (err, newAnalysis, context) => {
      // Rollback on error
      if (context?.previousHistory) {
        queryClient.setQueryData(ddaKeys.history(), context.previousHistory);
      }
    },
    onSuccess: () => {
      // Invalidate history to trigger refetch and sync with server
      queryClient.invalidateQueries({ queryKey: ddaKeys.history() });
    },
  });
}

/**
 * Hook to delete DDA analysis from history
 *
 * @returns Mutation object for deleting analysis
 *
 * @example
 * const deleteAnalysis = useDeleteDDAFromHistory();
 *
 * deleteAnalysis.mutate('result_id', {
 *   onSuccess: () => console.log('Deleted from history')
 * });
 */
export function useDeleteDDAFromHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (resultId: string) => {
      return tauriBackendService.deleteDDAFromHistory(resultId);
    },
    onSuccess: () => {
      // Invalidate history to trigger refetch
      queryClient.invalidateQueries({ queryKey: ddaKeys.history() });
    },
  });
}

/**
 * Utility hook to invalidate DDA cache
 *
 * @returns Object with cache invalidation functions
 *
 * @example
 * const { invalidateHistory, invalidateResult } = useInvalidateDDACache();
 *
 * // After manual backend changes
 * invalidateHistory();
 */
export function useInvalidateDDACache() {
  const queryClient = useQueryClient();

  return {
    /**
     * Invalidate analysis history cache
     */
    invalidateHistory: () => {
      queryClient.invalidateQueries({ queryKey: ddaKeys.history() });
    },

    /**
     * Invalidate specific result cache
     */
    invalidateResult: (resultId: string) => {
      queryClient.invalidateQueries({ queryKey: ddaKeys.result(resultId) });
    },

    /**
     * Clear all DDA cache
     */
    clearAll: () => {
      queryClient.removeQueries({ queryKey: ddaKeys.all });
    },
  };
}

/**
 * Hook to delete an analysis with optimistic updates
 *
 * @returns Mutation object for deleting analysis
 *
 * @example
 * const deleteAnalysis = useDeleteAnalysis();
 * deleteAnalysis.mutate(analysisId);
 */
export function useDeleteAnalysis() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (analysisId: string) =>
      tauriBackendService.deleteDDAFromHistory(analysisId),

    // Optimistic update: immediately remove from UI
    onMutate: async (analysisId: string) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ddaKeys.history() });

      // Snapshot previous value
      const previousHistory = queryClient.getQueryData<DDAResult[]>(
        ddaKeys.history(),
      );

      // Optimistically update to the new value
      if (previousHistory) {
        queryClient.setQueryData<DDAResult[]>(
          ddaKeys.history(),
          previousHistory.filter((analysis) => analysis.id !== analysisId),
        );
      }

      // Return context with previous value
      return { previousHistory };
    },

    // On error, roll back to previous value
    onError: (err, analysisId, context) => {
      if (context?.previousHistory) {
        queryClient.setQueryData(ddaKeys.history(), context.previousHistory);
      }
    },

    // Always refetch after error or success to ensure consistency
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ddaKeys.history() });
    },
  });
}

/**
 * Hook to rename an analysis with optimistic updates
 *
 * @returns Mutation object for renaming analysis
 *
 * @example
 * const renameAnalysis = useRenameAnalysis();
 * renameAnalysis.mutate({ analysisId: '123', newName: 'My Analysis' });
 */
export function useRenameAnalysis() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      analysisId,
      newName,
    }: {
      analysisId: string;
      newName: string;
    }) => tauriBackendService.renameDDAInHistory(analysisId, newName),

    // Optimistic update: immediately update name in UI
    onMutate: async ({ analysisId, newName }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ddaKeys.history() });

      // Snapshot previous value
      const previousHistory = queryClient.getQueryData<DDAResult[]>(
        ddaKeys.history(),
      );

      // Optimistically update to the new value
      if (previousHistory) {
        queryClient.setQueryData<DDAResult[]>(
          ddaKeys.history(),
          previousHistory.map((analysis) =>
            analysis.id === analysisId
              ? { ...analysis, name: newName }
              : analysis,
          ),
        );
      }

      // Return context with previous value
      return { previousHistory };
    },

    // On error, roll back to previous value
    onError: (err, variables, context) => {
      if (context?.previousHistory) {
        queryClient.setQueryData(ddaKeys.history(), context.previousHistory);
      }
    },

    // Always refetch after error or success to ensure consistency
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ddaKeys.history() });
    },
  });
}
