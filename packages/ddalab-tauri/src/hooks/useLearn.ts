"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TauriService } from "@/services/tauriService";
import type {
  SampleDataIndex,
  PaperRecipeIndex,
  SampleDataset,
} from "@/types/learn";
import { useAppStore } from "@/store/appStore";

const SAMPLE_DATA_INDEX_URL =
  "https://raw.githubusercontent.com/sdraeger/ddalab-data/main/sample-data-index.json";
const RECIPES_INDEX_URL =
  "https://raw.githubusercontent.com/sdraeger/ddalab-data/main/recipes-index.json";

export const learnKeys = {
  all: ["learn"] as const,
  sampleIndex: () => [...learnKeys.all, "sample-index"] as const,
  recipesIndex: () => [...learnKeys.all, "recipes-index"] as const,
  downloadedSamples: () => [...learnKeys.all, "downloaded"] as const,
};

export function useSampleDataIndex() {
  const setSampleDataIndex = useAppStore((s) => s.setSampleDataIndex);

  return useQuery({
    queryKey: learnKeys.sampleIndex(),
    queryFn: async () => {
      const raw = await TauriService.fetchRemoteIndex(SAMPLE_DATA_INDEX_URL);
      const index: SampleDataIndex = JSON.parse(raw);
      setSampleDataIndex(index.datasets);
      return index.datasets;
    },
    staleTime: 5 * 60_000,
  });
}

export function usePaperRecipesIndex() {
  const setRecipesIndex = useAppStore((s) => s.setRecipesIndex);

  return useQuery({
    queryKey: learnKeys.recipesIndex(),
    queryFn: async () => {
      const raw = await TauriService.fetchRemoteIndex(RECIPES_INDEX_URL);
      const index: PaperRecipeIndex = JSON.parse(raw);
      setRecipesIndex(index.recipes);
      return index.recipes;
    },
    staleTime: 5 * 60_000,
  });
}

export function useDownloadedSamples() {
  return useQuery({
    queryKey: learnKeys.downloadedSamples(),
    queryFn: () => TauriService.listDownloadedSamples(),
    staleTime: 30_000,
  });
}

export function useDownloadSampleData() {
  const queryClient = useQueryClient();
  const setSampleDataStatus = useAppStore((s) => s.setSampleDataStatus);

  return useMutation({
    mutationFn: async (dataset: SampleDataset) => {
      const ext = dataset.format.toLowerCase();
      setSampleDataStatus(dataset.id, { downloading: true, progress: 0 });
      const path = await TauriService.downloadSampleData(
        dataset.url,
        dataset.id,
        ext,
      );
      return { id: dataset.id, path };
    },
    onSuccess: ({ id, path }) => {
      setSampleDataStatus(id, {
        downloaded: true,
        path,
        downloading: false,
        progress: 100,
      });
      queryClient.invalidateQueries({
        queryKey: learnKeys.downloadedSamples(),
      });
    },
    onError: (_err, dataset) => {
      setSampleDataStatus(dataset.id, { downloading: false, progress: 0 });
    },
  });
}

export function useDeleteSampleData() {
  const queryClient = useQueryClient();
  const setSampleDataStatus = useAppStore((s) => s.setSampleDataStatus);

  return useMutation({
    mutationFn: (datasetId: string) => TauriService.deleteSampleData(datasetId),
    onSuccess: (_data, datasetId) => {
      setSampleDataStatus(datasetId, {
        downloaded: false,
        path: null,
        downloading: false,
        progress: 0,
      });
      queryClient.invalidateQueries({
        queryKey: learnKeys.downloadedSamples(),
      });
    },
  });
}
