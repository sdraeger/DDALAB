import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { openNeuroService, DownloadOptions, OpenNeuroDataset } from '@/services/openNeuroService';

export const openNeuroKeys = {
  all: ['openNeuro'] as const,
  datasets: () => [...openNeuroKeys.all, 'datasets'] as const,
  datasetsBatch: (after?: string) => [...openNeuroKeys.datasets(), 'batch', after] as const,
  dataset: (id: string) => [...openNeuroKeys.all, 'dataset', id] as const,
  datasetFiles: (id: string, snapshot?: string) => [...openNeuroKeys.dataset(id), 'files', snapshot] as const,
  datasetSize: (id: string, snapshot?: string) => [...openNeuroKeys.dataset(id), 'size', snapshot] as const,
  apiKey: () => [...openNeuroKeys.all, 'apiKey'] as const,
  gitAvailable: () => [...openNeuroKeys.all, 'git'] as const,
  gitAnnexAvailable: () => [...openNeuroKeys.all, 'gitAnnex'] as const,
};

export function useOpenNeuroDatasets(query?: string) {
  return useQuery({
    queryKey: [...openNeuroKeys.datasets(), query],
    queryFn: () => openNeuroService.searchDatasets(query),
    staleTime: 10 * 60 * 1000, // 10 minutes - datasets don't change frequently
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

export function useOpenNeuroDatasetsBatch(limit: number = 50, after?: string) {
  return useQuery({
    queryKey: openNeuroKeys.datasetsBatch(after),
    queryFn: () => openNeuroService.fetchDatasetsBatch(limit, after),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

export function useOpenNeuroDataset(datasetId: string, enabled: boolean = true) {
  return useQuery({
    queryKey: openNeuroKeys.dataset(datasetId),
    queryFn: () => openNeuroService.getDataset(datasetId),
    enabled,
    staleTime: 15 * 60 * 1000, // 15 minutes
  });
}

export function useOpenNeuroDatasetFiles(datasetId: string, snapshotTag?: string, enabled: boolean = true) {
  return useQuery({
    queryKey: openNeuroKeys.datasetFiles(datasetId, snapshotTag),
    queryFn: () => openNeuroService.getDatasetFiles(datasetId, snapshotTag),
    enabled,
    staleTime: 15 * 60 * 1000,
  });
}

export function useOpenNeuroDatasetSize(datasetId: string, snapshotTag?: string, enabled: boolean = true) {
  return useQuery({
    queryKey: openNeuroKeys.datasetSize(datasetId, snapshotTag),
    queryFn: () => openNeuroService.getDatasetSize(datasetId, snapshotTag),
    enabled,
    staleTime: 15 * 60 * 1000,
  });
}

export function useOpenNeuroApiKey() {
  return useQuery({
    queryKey: openNeuroKeys.apiKey(),
    queryFn: () => openNeuroService.checkApiKey(),
    staleTime: Infinity, // API key doesn't change unless user updates it
  });
}

export function useGitAvailable() {
  return useQuery({
    queryKey: openNeuroKeys.gitAvailable(),
    queryFn: () => openNeuroService.checkGitAvailable(),
    staleTime: Infinity, // Git availability doesn't change during session
  });
}

export function useGitAnnexAvailable() {
  return useQuery({
    queryKey: openNeuroKeys.gitAnnexAvailable(),
    queryFn: () => openNeuroService.checkGitAnnexAvailable(),
    staleTime: Infinity,
  });
}

export function useSaveApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (apiKey: string) => openNeuroService.saveApiKey(apiKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: openNeuroKeys.apiKey() });
    },
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => openNeuroService.deleteApiKey(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: openNeuroKeys.apiKey() });
    },
  });
}

export function useDownloadDataset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (options: DownloadOptions) => openNeuroService.downloadDataset(options),
    onSuccess: (downloadPath, variables) => {
      queryClient.invalidateQueries({ queryKey: openNeuroKeys.dataset(variables.dataset_id) });
    },
  });
}

export function useCancelDownload() {
  return useMutation({
    mutationFn: (datasetId: string) => openNeuroService.cancelDownload(datasetId),
  });
}
