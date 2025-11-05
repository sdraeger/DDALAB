import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { ApiService } from "@/services/apiService";
import { DDAAnalysisRequest, DDAResult, DDAProgressEvent } from "@/types/api";

/**
 * Query key factory for DDA analysis operations
 */
export const ddaKeys = {
  all: ["dda"] as const,
  history: () => [...ddaKeys.all, "history"] as const,
  result: (resultId: string) => [...ddaKeys.all, "result", resultId] as const,
  status: (resultId: string) => [...ddaKeys.all, "status", resultId] as const,
};

/**
 * Hook to submit DDA analysis with mutation
 *
 * @param apiService - API service instance
 * @returns Mutation object for submitting DDA analysis
 *
 * @example
 * const submitAnalysis = useSubmitDDAAnalysis(apiService);
 *
 * const handleSubmit = () => {
 *   submitAnalysis.mutate(request, {
 *     onSuccess: (result) => {
 *       console.log('Analysis submitted:', result.id);
 *     }
 *   });
 * };
 */
export function useSubmitDDAAnalysis(apiService: ApiService) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: DDAAnalysisRequest) => {
      return apiService.submitDDAAnalysis(request);
    },
    onSuccess: (result) => {
      // Add the new result to the history cache immediately
      queryClient.setQueryData<DDAResult[]>(ddaKeys.history(), (old) => {
        return old ? [result, ...old] : [result];
      });

      // Invalidate history to trigger refetch (for server-side changes)
      queryClient.invalidateQueries({ queryKey: ddaKeys.history() });
    },
    retry: 1, // Retry once on failure
  });
}

/**
 * Hook to fetch DDA analysis result by ID
 *
 * @param apiService - API service instance
 * @param resultId - Analysis result ID
 * @param enabled - Whether to enable the query (default: true)
 * @returns Query result with analysis data
 *
 * @example
 * const { data: result, isLoading } = useDDAResult(apiService, 'dda_123');
 */
export function useDDAResult(
  apiService: ApiService,
  resultId: string,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ddaKeys.result(resultId),
    queryFn: () => apiService.getDDAResult(resultId),
    enabled: enabled && !!resultId,
    staleTime: Infinity, // Results never change once completed
    gcTime: 60 * 60 * 1000, // Keep in cache for 1 hour
    retry: 2,
  });
}

/**
 * Hook to fetch DDA analysis history
 *
 * @param apiService - API service instance
 * @param enabled - Whether to enable the query (default: true)
 * @returns Query result with analysis history
 *
 * @example
 * const { data: history, isLoading, refetch } = useDDAHistory(apiService);
 */
export function useDDAHistory(apiService: ApiService, enabled: boolean = true) {
  return useQuery({
    queryKey: ddaKeys.history(),
    queryFn: () => apiService.getAnalysisHistory(),
    enabled,
    staleTime: 30 * 1000, // Refetch after 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    retry: 2,
    refetchOnWindowFocus: true, // Refetch when window regains focus
  });
}

/**
 * Hook to fetch full analysis from history by ID (async, non-blocking)
 *
 * @param apiService - API service instance
 * @param analysisId - Analysis ID to load from history
 * @param enabled - Whether to enable the query (default: false, must opt-in)
 * @returns Query result with full analysis data
 *
 * @example
 * const { data: analysis, isLoading } = useAnalysisFromHistory(apiService, 'abc-123', true);
 */
export function useAnalysisFromHistory(
  apiService: ApiService,
  analysisId: string | null,
  enabled: boolean = false,
) {
  return useQuery({
    queryKey: [...ddaKeys.result(analysisId || ""), "from-history"],
    queryFn: () => apiService.getAnalysisFromHistory(analysisId!),
    enabled: enabled && !!analysisId,
    staleTime: Infinity, // Analysis data never changes once saved
    gcTime: 60 * 60 * 1000, // Keep in cache for 1 hour
    retry: 2,
  });
}

/**
 * Hook to save DDA analysis to history
 *
 * @param apiService - API service instance
 * @returns Mutation object for saving analysis
 *
 * @example
 * const saveToHistory = useSaveDDAToHistory(apiService);
 *
 * saveToHistory.mutate(result, {
 *   onSuccess: () => console.log('Saved to history')
 * });
 */
export function useSaveDDAToHistory(apiService: ApiService) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (result: DDAResult) => {
      return apiService.saveAnalysisToHistory(result);
    },
    onSuccess: () => {
      // Invalidate history to trigger refetch
      queryClient.invalidateQueries({ queryKey: ddaKeys.history() });
    },
  });
}

/**
 * Hook to delete DDA analysis from history
 *
 * @param apiService - API service instance
 * @returns Mutation object for deleting analysis
 *
 * @example
 * const deleteAnalysis = useDeleteDDAFromHistory(apiService);
 *
 * deleteAnalysis.mutate('result_id', {
 *   onSuccess: () => console.log('Deleted from history')
 * });
 */
export function useDeleteDDAFromHistory(apiService: ApiService) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (resultId: string) => {
      return apiService.deleteAnalysisFromHistory(resultId);
    },
    onSuccess: () => {
      // Invalidate history to trigger refetch
      queryClient.invalidateQueries({ queryKey: ddaKeys.history() });
    },
  });
}

/**
 * Hook to listen to DDA progress events from Tauri backend
 *
 * This hook sets up an event listener for real-time progress updates
 * during DDA analysis computation. The backend emits events as the
 * analysis progresses through different phases.
 *
 * @param analysisId - Analysis ID to track (optional - tracks all if not provided)
 * @param enabled - Whether to enable the listener (default: true)
 * @returns Current progress state
 *
 * @example
 * const { data: result } = useSubmitDDAAnalysis(apiService);
 * const progress = useDDAProgress(result?.id);
 *
 * if (progress) {
 *   console.log(`${progress.phase}: ${progress.progress_percent}%`);
 *   console.log(progress.current_step);
 * }
 */
export function useDDAProgress(
  analysisId?: string,
  enabled: boolean = true,
): DDAProgressEvent | null {
  const [progress, setProgress] = useState<DDAProgressEvent | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let unlisten: UnlistenFn | null = null;

    // Set up event listener
    const setupListener = async () => {
      unlisten = await listen<DDAProgressEvent>("dda-progress", (event) => {
        // If analysisId is provided, only update for matching analysis
        if (!analysisId || event.payload.analysis_id === analysisId) {
          console.log("[DDA Progress]", event.payload);
          setProgress(event.payload);
        }
      });
    };

    setupListener();

    // Cleanup listener on unmount
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [analysisId, enabled]);

  return progress;
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
 * @param apiService - API service instance
 * @returns Mutation object for deleting analysis
 *
 * @example
 * const deleteAnalysis = useDeleteAnalysis(apiService);
 * deleteAnalysis.mutate(analysisId);
 */
export function useDeleteAnalysis(apiService: ApiService) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (analysisId: string) =>
      apiService.deleteAnalysisFromHistory(analysisId),

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
 * @param apiService - API service instance
 * @returns Mutation object for renaming analysis
 *
 * @example
 * const renameAnalysis = useRenameAnalysis(apiService);
 * renameAnalysis.mutate({ analysisId: '123', newName: 'My Analysis' });
 */
export function useRenameAnalysis(apiService: ApiService) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      analysisId,
      newName,
    }: {
      analysisId: string;
      newName: string;
    }) => apiService.renameAnalysisInHistory(analysisId, newName),

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
