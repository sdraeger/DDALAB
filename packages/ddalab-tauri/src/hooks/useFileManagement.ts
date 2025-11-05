import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiService } from "@/services/apiService";
import type { EDFFileInfo } from "@/types/api";

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
  });
}

export interface DirectoryListingResult {
  files: Array<{
    name: string;
    path: string;
    is_directory: boolean;
    size?: number;
    last_modified?: string;
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
  });
}

export function useLoadFileInfo(apiService: ApiService) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (filePath: string) => apiService.getFileInfo(filePath),
    onSuccess: (data, filePath) => {
      queryClient.setQueryData(fileManagementKeys.fileInfo(filePath), data);
    },
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
