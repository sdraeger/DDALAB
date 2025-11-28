import { useQuery, useQueries } from "@tanstack/react-query";
import {
  isBIDSDataset,
  readDatasetDescription,
  getDatasetSummary,
} from "@/services/bids";
import type { DirectoryEntry, BIDSInfo } from "@/types/bids";

export const bidsKeys = {
  all: ["bids"] as const,
  detection: (path: string) => [...bidsKeys.all, "detection", path] as const,
  description: (path: string) =>
    [...bidsKeys.all, "description", path] as const,
  summary: (path: string) => [...bidsKeys.all, "summary", path] as const,
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

export function useBIDSMultipleDetections(
  directories: Array<{ name: string; path: string }>,
) {
  return useQueries({
    queries: directories.map((dir) => ({
      queryKey: bidsKeys.detection(dir.path),
      queryFn: async (): Promise<DirectoryEntry> => {
        try {
          const isBIDS = await isBIDSDataset(dir.path);

          if (!isBIDS) {
            return { ...dir, isBIDS: false };
          }

          const [description, summary] = await Promise.all([
            readDatasetDescription(dir.path),
            getDatasetSummary(dir.path),
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
            ...dir,
            isBIDS: true,
            bidsInfo,
          };
        } catch (error) {
          console.error(`Error checking BIDS for ${dir.name}:`, error);
          return { ...dir, isBIDS: false };
        }
      },
      staleTime: 15 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
    })),
  });
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
