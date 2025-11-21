import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useCallback } from "react";
import { ApiService } from "@/services/apiService";
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
 * Hook to submit ICA analysis with mutation and cancellation support
 */
export function useSubmitICAAnalysis(apiService: ApiService) {
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);

  const mutation = useMutation({
    mutationFn: async (request: ICAAnalysisRequest) => {
      console.log("[ICA Hook] Calling API with request:", request);

      // Create new AbortController for this request
      abortControllerRef.current = new AbortController();

      try {
        const result = await apiService.submitICAAnalysis(
          request,
          abortControllerRef.current.signal,
        );
        console.log("[ICA Hook] API returned:", result);
        return result;
      } catch (error) {
        if (error instanceof Error && error.name === "CanceledError") {
          console.log("[ICA Hook] Request was cancelled");
          throw new Error("Analysis cancelled by user");
        }
        console.error("[ICA Hook] API call failed:", error);
        throw error;
      } finally {
        abortControllerRef.current = null;
      }
    },
    onMutate: (variables) => {
      console.log("[ICA Hook] Mutation starting with variables:", variables);
    },
    onSuccess: (result) => {
      console.log("[ICA Hook] Mutation succeeded:", result.id);
      // Add the new result to the cache
      queryClient.setQueryData<ICAResult[]>(icaKeys.results(), (old) => {
        return old ? [result, ...old] : [result];
      });

      // Invalidate to trigger refetch
      queryClient.invalidateQueries({ queryKey: icaKeys.results() });
    },
    onError: (error) => {
      console.error("[ICA Hook] Mutation failed:", error);
    },
    retry: 0, // Don't retry on failure - user can manually retry
  });

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      console.log("[ICA Hook] Cancelling request");
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  return {
    ...mutation,
    cancel,
  };
}

/**
 * Hook to fetch all ICA analysis results
 */
export function useICAResults(apiService: ApiService) {
  return useQuery({
    queryKey: icaKeys.results(),
    queryFn: () => apiService.getICAResults(),
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch a specific ICA analysis result
 */
export function useICAResult(apiService: ApiService, analysisId: string) {
  return useQuery({
    queryKey: icaKeys.result(analysisId),
    queryFn: () => apiService.getICAResult(analysisId),
    enabled: !!analysisId,
  });
}

/**
 * Hook to delete an ICA analysis result
 */
export function useDeleteICAResult(apiService: ApiService) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (analysisId: string) => apiService.deleteICAResult(analysisId),
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
export function useReconstructWithoutComponents(apiService: ApiService) {
  return useMutation({
    mutationFn: (request: ReconstructRequest) =>
      apiService.reconstructWithoutComponents(request),
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
export function useICAWorkflow(apiService: ApiService) {
  const submitAnalysis = useSubmitICAAnalysis(apiService);
  const results = useICAResults(apiService);
  const deleteResult = useDeleteICAResult(apiService);
  const reconstruct = useReconstructWithoutComponents(apiService);
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
