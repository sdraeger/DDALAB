import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiService } from "@/services/apiService";
import type { EDFFileInfo } from "@/types/api";
import {
  createQueryErrorHandler,
  createMutationErrorHandler,
  queryErrorHandlers,
} from "@/utils/errorHandler";

export const fileManagementKeys = {
  all: ["fileManagement"] as const,
  files: () => [...fileManagementKeys.all, "files"] as const,
  fileInfo: (filePath: string) =>
    [...fileManagementKeys.all, "fileInfo", filePath] as const,
  directory: (path: string) =>
    [...fileManagementKeys.all, "directory", path] as const,
  availableFiles: () => [...fileManagementKeys.all, "availableFiles"] as const,
};

export function useAvailableFiles(apiService: ApiService) {
  return useQuery({
    queryKey: fileManagementKeys.availableFiles(),
    queryFn: () => apiService.getAvailableFiles(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,
    ...queryErrorHandlers.file("List"),
  });
}

export function useFileInfo(
  apiService: ApiService,
  filePath: string,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: fileManagementKeys.fileInfo(filePath),
    queryFn: () => apiService.getFileInfo(filePath),
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

export function useDirectoryListing(
  apiService: ApiService,
  path: string,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: fileManagementKeys.directory(path),
    queryFn: () => apiService.listDirectory(path),
    enabled: enabled && !!path,
    staleTime: 2 * 60 * 1000, // 2 minutes - directories can change more frequently
    gcTime: 5 * 60 * 1000,
    ...queryErrorHandlers.file("Directory"),
  });
}

export function useLoadFileInfo(apiService: ApiService) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (filePath: string) => apiService.getFileInfo(filePath),
    onSuccess: (data, filePath) => {
      queryClient.setQueryData(fileManagementKeys.fileInfo(filePath), data);
    },
    ...createMutationErrorHandler({
      source: "Load File Info",
      severity: "warning",
    }),
  });
}

export function useRefreshDirectory(apiService: ApiService) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (path: string) => apiService.listDirectory(path),
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
