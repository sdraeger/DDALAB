import { useQuery, useQueries } from "@tanstack/react-query";
import {
  isBIDSDataset,
  readDatasetDescription,
  getDatasetSummary,
  batchCheckBIDS,
} from "@/services/bids";
import type { DirectoryEntry, BIDSInfo } from "@/types/bids";

export const bidsKeys = {
  all: ["bids"] as const,
  detection: (path: string) => [...bidsKeys.all, "detection", path] as const,
  description: (path: string) =>
    [...bidsKeys.all, "description", path] as const,
  summary: (path: string) => [...bidsKeys.all, "summary", path] as const,
  batchDetection: (paths: string[]) =>
    [...bidsKeys.all, "batchDetection", paths.sort().join("|")] as const,
};

export function useBIDSDetection(
  directoryPath: string,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: bidsKeys.detection(directoryPath),
    queryFn: async (): Promise<{ isBIDS: boolean; bidsInfo?: BIDSInfo }> => {
      const isBIDS = await isBIDSDataset(directoryPath);

      if (!isBIDS) {
        return { isBIDS: false };
      }

      const [description, summary] = await Promise.all([
        readDatasetDescription(directoryPath),
        getDatasetSummary(directoryPath),
      ]);

      const bidsInfo: BIDSInfo = {
        datasetName: description?.Name,
        bidsVersion: description?.BIDSVersion,
        subjectCount: summary.subjectCount,
        sessionCount: summary.sessionCount,
        runCount: summary.runCount,
        modalities: Array.from(summary.modalities),
        tasks: Array.from(summary.tasks),
      };

      return {
        isBIDS: true,
        bidsInfo,
      };
    },
    enabled: enabled && !!directoryPath,
    staleTime: 15 * 60 * 1000, // 15 minutes - BIDS structure rarely changes
    gcTime: 30 * 60 * 1000,
  });
}

export function useBIDSDescription(
  directoryPath: string,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: bidsKeys.description(directoryPath),
    queryFn: () => readDatasetDescription(directoryPath),
    enabled: enabled && !!directoryPath,
    staleTime: 15 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

export function useBIDSSummary(directoryPath: string, enabled: boolean = true) {
  return useQuery({
    queryKey: bidsKeys.summary(directoryPath),
    queryFn: () => getDatasetSummary(directoryPath),
    enabled: enabled && !!directoryPath,
    staleTime: 15 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Batch check multiple directories for BIDS datasets using a single query.
 * This is optimized to:
 * 1. Run a quick check on all directories first (just exists + readDir)
 * 2. Only fetch full details (description, summary) for confirmed BIDS directories
 *
 * For 50 directories where 2 are BIDS, this reduces file system operations from
 * ~5000+ to ~100 (quick checks for all + full details for 2).
 */
export function useBIDSMultipleDetections(
  directories: Array<{ name: string; path: string }>,
) {
  const paths = directories.map((d) => d.path);

  const query = useQuery({
    queryKey: bidsKeys.batchDetection(paths),
    queryFn: async (): Promise<DirectoryEntry[]> => {
      if (directories.length === 0) return [];

      try {
        const results = await batchCheckBIDS(directories);

        return results.map((result) => {
          if (!result.isBIDS) {
            return {
              name: result.name,
              path: result.path,
              isBIDS: false,
            };
          }

          const bidsInfo: BIDSInfo = {
            datasetName: result.description?.Name,
            bidsVersion: result.description?.BIDSVersion,
            subjectCount: result.summary?.subjectCount ?? 0,
            sessionCount: result.summary?.sessionCount ?? 0,
            runCount: result.summary?.runCount ?? 0,
            modalities: result.summary?.modalities
              ? Array.from(result.summary.modalities)
              : [],
            tasks: result.summary?.tasks
              ? Array.from(result.summary.tasks)
              : [],
          };

          return {
            name: result.name,
            path: result.path,
            isBIDS: true,
            bidsInfo,
          };
        });
      } catch (error) {
        console.error("Error in batch BIDS detection:", error);
        return directories.map((dir) => ({
          name: dir.name,
          path: dir.path,
          isBIDS: false,
        }));
      }
    },
    enabled: directories.length > 0,
    staleTime: 15 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // Return array of query-like objects for backwards compatibility
  return (query.data ?? directories).map((entry, index) => ({
    data: query.data?.[index] ?? { ...directories[index], isBIDS: false },
    isLoading: query.isLoading,
    isSuccess: query.isSuccess,
    isError: query.isError,
    error: query.error,
  }));
}

/**
 * Hook to find BIDS root in parent directories.
 * Useful when navigating inside a BIDS dataset (e.g., after reveal).
 */
export function useBIDSParentDetection(
  currentPath: string[],
  dataDirectoryPath: string | null,
) {
  // Generate all parent paths to check
  const parentPaths = [];
  if (dataDirectoryPath && currentPath.length > 0) {
    for (let i = 1; i <= currentPath.length; i++) {
      const pathSegments = currentPath.slice(0, i);
      parentPaths.push({
        name: pathSegments[pathSegments.length - 1],
        path: `${dataDirectoryPath}/${pathSegments.join("/")}`,
        depth: i,
      });
    }
  }

  const queries = useQueries({
    queries: parentPaths.map((parent) => ({
      queryKey: bidsKeys.detection(parent.path),
      queryFn: async () => {
        const isBIDS = await isBIDSDataset(parent.path);
        return { ...parent, isBIDS };
      },
      staleTime: 15 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
    })),
  });

  // Find the first (shallowest) BIDS root
  const bidsParent = queries.find((q) => q.isSuccess && q.data?.isBIDS);

  return {
    isLoading: queries.some((q) => q.isLoading),
    bidsRoot: bidsParent?.data?.path || null,
    bidsRootDepth: bidsParent?.data?.depth || 0,
    currentDepthInBids: bidsParent?.data
      ? currentPath.length - bidsParent.data.depth
      : 0,
  };
}
