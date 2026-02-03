import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tauriBackendService } from "@/services/tauriBackendService";
import type { EDFFileInfo } from "@/types/api";
import {
  createMutationErrorHandler,
  queryErrorHandlers,
} from "@/utils/errorHandler";
import { createLogger } from "@/lib/logger";

const logger = createLogger("useFileManagement");

export const fileManagementKeys = {
  all: ["fileManagement"] as const,
  files: () => [...fileManagementKeys.all, "files"] as const,
  fileInfo: (filePath: string) =>
    [...fileManagementKeys.all, "fileInfo", filePath] as const,
  directory: (path: string) =>
    [...fileManagementKeys.all, "directory", path] as const,
  availableFiles: () => [...fileManagementKeys.all, "availableFiles"] as const,
};

export function useAvailableFiles() {
  return useQuery({
    queryKey: fileManagementKeys.availableFiles(),
    queryFn: () => tauriBackendService.listDataFiles(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,
    ...queryErrorHandlers.file("List"),
  });
}

export function useFileInfo(filePath: string, enabled: boolean = true) {
  return useQuery({
    queryKey: fileManagementKeys.fileInfo(filePath),
    queryFn: () => tauriBackendService.getEdfInfo(filePath),
    enabled: enabled && !!filePath,
    staleTime: 10 * 60 * 1000, // 10 minutes - file metadata rarely changes
    gcTime: 30 * 60 * 1000,
    ...queryErrorHandlers.file("Info"),
  });
}

export interface DirectoryListingResult {
  files: Array<{
    name: string;
    path: string;
    is_directory: boolean;
    size?: number;
    last_modified?: string;
    /** True if file is a git-annex symlink that hasn't been downloaded */
    is_annex_placeholder?: boolean;
  }>;
}

export function useDirectoryListing(path: string, enabled: boolean = true) {
  const finalEnabled = enabled && !!path;

  // Note: Debug logging removed to avoid performance impact from logging on every render

  return useQuery({
    queryKey: fileManagementKeys.directory(path),
    queryFn: async (): Promise<DirectoryListingResult> => {
      try {
        const result = await tauriBackendService.listDirectory(path);
        // Transform DirectoryListing (camelCase from Tauri) to DirectoryListingResult (snake_case)
        const transformed: DirectoryListingResult = {
          files: result.entries.map((entry) => ({
            name: entry.name,
            path: entry.path,
            is_directory: entry.isDirectory,
            size: entry.size,
            last_modified: entry.modified,
            is_annex_placeholder: entry.isAnnexPlaceholder,
          })),
        };
        return transformed;
      } catch (error) {
        // Better error serialization for logging
        let errorMessage = "Unknown error";
        let errorDetails: Record<string, unknown> = {};

        if (error instanceof Error) {
          errorMessage = error.message;
          errorDetails.name = error.name;
          errorDetails.stack = error.stack?.split("\n").slice(0, 3).join("\n");
        } else if (typeof error === "object" && error !== null) {
          errorMessage = JSON.stringify(error);
          errorDetails = error as Record<string, unknown>;
        } else {
          errorMessage = String(error);
        }

        logger.error("Directory listing query failed", {
          path,
          error: errorMessage,
          ...errorDetails,
        });
        throw error;
      }
    },
    enabled: finalEnabled,
    staleTime: 2 * 60 * 1000, // 2 minutes - directories can change more frequently
    gcTime: 5 * 60 * 1000,
    ...queryErrorHandlers.file("Directory"),
  });
}

export function useLoadFileInfo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (filePath: string) => tauriBackendService.getEdfInfo(filePath),
    onSuccess: (data, filePath) => {
      queryClient.setQueryData(fileManagementKeys.fileInfo(filePath), data);
    },
    ...createMutationErrorHandler({
      source: "Load File Info",
      severity: "warning",
    }),
  });
}

export function useRefreshDirectory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (path: string): Promise<DirectoryListingResult> => {
      const result = await tauriBackendService.listDirectory(path);
      // Transform DirectoryListing (camelCase from Tauri) to DirectoryListingResult (snake_case)
      return {
        files: result.entries.map((entry) => ({
          name: entry.name,
          path: entry.path,
          is_directory: entry.isDirectory,
          size: entry.size,
          last_modified: entry.modified,
          is_annex_placeholder: entry.isAnnexPlaceholder,
        })),
      };
    },
    onSuccess: (data, path) => {
      queryClient.setQueryData(fileManagementKeys.directory(path), data);
      queryClient.invalidateQueries({
        queryKey: fileManagementKeys.directory(path),
      });
    },
    ...createMutationErrorHandler({
      source: "Refresh Directory",
      severity: "warning",
    }),
  });
}

export function useInvalidateFileCache() {
  const queryClient = useQueryClient();

  return {
    invalidateAllFiles: () => {
      queryClient.invalidateQueries({ queryKey: fileManagementKeys.files() });
    },
    invalidateFileInfo: (filePath: string) => {
      queryClient.invalidateQueries({
        queryKey: fileManagementKeys.fileInfo(filePath),
      });
    },
    invalidateDirectory: (path: string) => {
      queryClient.invalidateQueries({
        queryKey: fileManagementKeys.directory(path),
      });
    },
    clearAllCache: () => {
      queryClient.invalidateQueries({ queryKey: fileManagementKeys.all });
    },
  };
}
