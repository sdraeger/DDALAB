import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TauriService, type NSGJob } from "@/services/tauriService";

// Query keys factory for NSG operations
export const nsgKeys = {
  all: ["nsg"] as const,
  credentials: () => [...nsgKeys.all, "credentials"] as const,
  jobs: () => [...nsgKeys.all, "jobs"] as const,
  job: (jobId: string) => [...nsgKeys.all, "job", jobId] as const,
  jobStatus: (jobId: string) => [...nsgKeys.all, "jobStatus", jobId] as const,
};

// Helper function to check if a job is external (not created via DDALAB)
export function isExternalJob(job: NSGJob): boolean {
  return job.dda_params?.external === true;
}

// Check if NSG credentials are configured
export function useNSGCredentials() {
  return useQuery({
    queryKey: nsgKeys.credentials(),
    queryFn: async () => {
      if (!TauriService.isTauri()) {
        return false;
      }
      return await TauriService.hasNSGCredentials();
    },
    staleTime: 5 * 1000, // 5 seconds
    gcTime: 30 * 1000, // 30 seconds
    refetchInterval: 5 * 1000, // Poll every 5 seconds to detect credential changes
    enabled: TauriService.isTauri(),
  });
}

// List all NSG jobs with polling
export function useNSGJobs(options?: {
  enabled?: boolean;
  refetchInterval?: number;
}) {
  return useQuery({
    queryKey: nsgKeys.jobs(),
    queryFn: async () => {
      if (!TauriService.isTauri()) {
        return [];
      }
      const jobs = await TauriService.listNSGJobs();
      // Sort by creation date (newest first)
      return jobs.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    },
    staleTime: 10 * 1000, // 10 seconds
    gcTime: 60 * 1000, // 1 minute
    refetchInterval: options?.refetchInterval ?? 30 * 1000, // Poll every 30 seconds
    enabled: options?.enabled ?? TauriService.isTauri(),
    refetchOnWindowFocus: true,
  });
}

// Get specific job status
export function useNSGJobStatus(jobId: string | null) {
  return useQuery({
    queryKey: jobId ? nsgKeys.jobStatus(jobId) : ["nsg", "jobStatus", "null"],
    queryFn: async () => {
      if (!jobId || !TauriService.isTauri()) {
        return null;
      }
      return await TauriService.getNSGJobStatus(jobId);
    },
    staleTime: 5 * 1000, // 5 seconds
    gcTime: 30 * 1000, // 30 seconds
    enabled: !!jobId && TauriService.isTauri(),
    // Note: Cache updates are handled by useUpdateNSGJobStatus mutation
  });
}

// Mutation to update job status
export function useUpdateNSGJobStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      if (!TauriService.isTauri()) {
        throw new Error("NSG operations only available in Tauri");
      }
      return await TauriService.getNSGJobStatus(jobId);
    },
    onSuccess: (updatedJob) => {
      // Update the jobs list cache
      queryClient.setQueryData<NSGJob[]>(nsgKeys.jobs(), (oldJobs) => {
        if (!oldJobs) return [updatedJob];
        return oldJobs.map((job) =>
          job.id === updatedJob.id ? updatedJob : job,
        );
      });
      // Update the specific job status cache
      queryClient.setQueryData(nsgKeys.jobStatus(updatedJob.id), updatedJob);
    },
  });
}

// Mutation to download NSG results
export function useDownloadNSGResults() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      if (!TauriService.isTauri()) {
        throw new Error("NSG operations only available in Tauri");
      }
      return await TauriService.downloadNSGResults(jobId);
    },
    onSuccess: (files, jobId) => {
      // Refetch jobs to show updated output_files
      queryClient.invalidateQueries({ queryKey: nsgKeys.jobs() });
      return files;
    },
  });
}

// Mutation to cancel NSG job
export function useCancelNSGJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      if (!TauriService.isTauri()) {
        throw new Error("NSG operations only available in Tauri");
      }
      await TauriService.cancelNSGJob(jobId);
      return jobId;
    },
    onSuccess: () => {
      // Refetch jobs to show updated status
      queryClient.invalidateQueries({ queryKey: nsgKeys.jobs() });
    },
  });
}

// Mutation to delete NSG job
export function useDeleteNSGJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      if (!TauriService.isTauri()) {
        throw new Error("NSG operations only available in Tauri");
      }
      await TauriService.deleteNSGJob(jobId);
      return jobId;
    },
    onMutate: async (jobId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: nsgKeys.jobs() });

      // Snapshot the previous value
      const previousJobs = queryClient.getQueryData<NSGJob[]>(nsgKeys.jobs());

      // Optimistically update to remove the job
      queryClient.setQueryData<NSGJob[]>(nsgKeys.jobs(), (old) => {
        if (!old) return [];
        return old.filter((job) => job.id !== jobId);
      });

      return { previousJobs };
    },
    onError: (err, jobId, context) => {
      // Rollback on error
      if (context?.previousJobs) {
        queryClient.setQueryData(nsgKeys.jobs(), context.previousJobs);
      }
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: nsgKeys.jobs() });
    },
  });
}

// Mutation to cleanup pending NSG jobs
export function useCleanupPendingNSGJobs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!TauriService.isTauri()) {
        throw new Error("NSG operations only available in Tauri");
      }
      return await TauriService.cleanupPendingNSGJobs();
    },
    onSuccess: () => {
      // Refetch jobs to show updated list
      queryClient.invalidateQueries({ queryKey: nsgKeys.jobs() });
    },
  });
}

// Mutation to extract NSG tarball
export function useExtractNSGTarball() {
  return useMutation({
    mutationFn: async ({
      jobId,
      tarFilePath,
    }: {
      jobId: string;
      tarFilePath: string;
    }) => {
      if (!TauriService.isTauri()) {
        throw new Error("NSG operations only available in Tauri");
      }
      return await TauriService.extractNSGTarball(jobId, tarFilePath);
    },
  });
}

// Cache invalidation helper
export function useInvalidateNSGCache() {
  const queryClient = useQueryClient();

  return {
    invalidateCredentials: () =>
      queryClient.invalidateQueries({ queryKey: nsgKeys.credentials() }),
    invalidateJobs: () =>
      queryClient.invalidateQueries({ queryKey: nsgKeys.jobs() }),
    invalidateJob: (jobId: string) =>
      queryClient.invalidateQueries({ queryKey: nsgKeys.job(jobId) }),
    invalidateJobStatus: (jobId: string) =>
      queryClient.invalidateQueries({ queryKey: nsgKeys.jobStatus(jobId) }),
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: nsgKeys.all }),
  };
}
