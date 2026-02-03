import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { tauriBackendService } from "@/services/tauriBackendService";
import {
  ICAAnalysisRequest,
  ICAResult,
  ReconstructRequest,
  ReconstructResponse,
} from "@/types/ica";

/**
 * Query key factory for ICA analysis operations
 */
export const icaKeys = {
  all: ["ica"] as const,
  results: () => [...icaKeys.all, "results"] as const,
  result: (resultId: string) => [...icaKeys.all, "result", resultId] as const,
};

/**
 * Hook to submit ICA analysis with mutation support
 * Note: Cancellation is not supported via Tauri IPC - analysis runs to completion
 */
export function useSubmitICAAnalysis() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (request: ICAAnalysisRequest) => {
      const result = await tauriBackendService.submitICAAnalysis(request);
      return result;
    },
    onSuccess: (result) => {
      queryClient.setQueryData<ICAResult[]>(icaKeys.results(), (old) => {
        return old ? [result, ...old] : [result];
      });
    },
    retry: 0,
  });

  const cancel = useCallback(() => {
    // Cancellation not supported via Tauri IPC
    // Analysis runs to completion once started
  }, []);

  return {
    ...mutation,
    cancel,
  };
}

/**
 * Hook to fetch all ICA analysis results (with full data)
 * Fetches history entries first, then loads full results for each
 */
export function useICAResults() {
  return useQuery({
    queryKey: icaKeys.results(),
    queryFn: async (): Promise<ICAResult[]> => {
      // Get history entries (lightweight)
      const historyEntries = await tauriBackendService.getICAResults();

      // Fetch full results for each entry
      const fullResults = await Promise.all(
        historyEntries.map((entry) =>
          tauriBackendService.getICAResult(entry.id),
        ),
      );

      // Filter out nulls and return
      return fullResults.filter((r): r is ICAResult => r !== null);
    },
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch a specific ICA analysis result
 */
export function useICAResult(analysisId: string) {
  return useQuery({
    queryKey: icaKeys.result(analysisId),
    queryFn: () => tauriBackendService.getICAResult(analysisId),
    enabled: !!analysisId,
  });
}

/**
 * Hook to delete an ICA analysis result
 */
export function useDeleteICAResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (analysisId: string) =>
      tauriBackendService.deleteICAResult(analysisId),
    onSuccess: (_, analysisId) => {
      // Remove from cache
      queryClient.setQueryData<ICAResult[]>(icaKeys.results(), (old) => {
        return old ? old.filter((r) => r.id !== analysisId) : [];
      });
    },
  });
}

/**
 * Hook to reconstruct data without selected components (artifact removal)
 */
export function useReconstructWithoutComponents() {
  return useMutation({
    mutationFn: (request: ReconstructRequest) =>
      tauriBackendService.icaReconstructWithoutComponents(
        request.analysis_id,
        request.components_to_remove,
      ),
  });
}

/**
 * State for managing marked artifact components
 */
export function useArtifactComponents() {
  const [markedComponents, setMarkedComponents] = useState<Set<number>>(
    new Set(),
  );

  const toggleComponent = (componentId: number) => {
    setMarkedComponents((prev) => {
      const next = new Set(prev);
      if (next.has(componentId)) {
        next.delete(componentId);
      } else {
        next.add(componentId);
      }
      return next;
    });
  };

  const clearMarked = () => {
    setMarkedComponents(new Set());
  };

  const markMultiple = (componentIds: number[]) => {
    setMarkedComponents(new Set(componentIds));
  };

  return {
    markedComponents,
    toggleComponent,
    clearMarked,
    markMultiple,
    isMarked: (id: number) => markedComponents.has(id),
    markedArray: Array.from(markedComponents),
  };
}

/**
 * Combined hook for complete ICA workflow
 */
export function useICAWorkflow() {
  const submitAnalysis = useSubmitICAAnalysis();
  const results = useICAResults();
  const deleteResult = useDeleteICAResult();
  const reconstruct = useReconstructWithoutComponents();
  const artifacts = useArtifactComponents();

  return {
    // Analysis submission
    submit: submitAnalysis.mutate,
    isSubmitting: submitAnalysis.isPending,
    submitError: submitAnalysis.error,
    cancelSubmit: submitAnalysis.cancel,

    // Results
    results: results.data || [],
    isLoadingResults: results.isLoading,
    resultsError: results.error,
    refetchResults: results.refetch,

    // Delete
    deleteResult: deleteResult.mutate,
    isDeleting: deleteResult.isPending,

    // Reconstruction
    reconstruct: reconstruct.mutate,
    isReconstructing: reconstruct.isPending,
    reconstructedData: reconstruct.data,

    // Artifact management
    ...artifacts,
  };
}
