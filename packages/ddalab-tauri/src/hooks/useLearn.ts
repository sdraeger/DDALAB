"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TauriService } from "@/services/tauriService";
import type { SampleDataset } from "@/types/learn";
import { useAppStore } from "@/store/appStore";
import { createLogger } from "@/lib/logger";
import {
  getCatalogErrorMessage,
  getSampleDownloadErrorMessage,
  parsePaperRecipesIndex,
  parseSampleDataIndex,
} from "@/lib/learnCatalog";

const SAMPLE_DATA_INDEX_URL =
  "https://raw.githubusercontent.com/sdraeger/ddalab-data/main/sample-data-index.json";
const RECIPES_INDEX_URL =
  "https://raw.githubusercontent.com/sdraeger/ddalab-data/main/recipes-index.json";
const logger = createLogger("useLearn");

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
      try {
        const raw = await TauriService.fetchRemoteIndex(SAMPLE_DATA_INDEX_URL);
        const datasets = parseSampleDataIndex(raw);
        setSampleDataIndex(datasets);
        return datasets;
      } catch (error) {
        logger.warn("Failed to load sample data index", { error });
        throw new Error(getCatalogErrorMessage("sample data catalog", error));
      }
    },
    staleTime: 5 * 60_000,
    retry: 1,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 3000),
  });
}

export function usePaperRecipesIndex() {
  const setRecipesIndex = useAppStore((s) => s.setRecipesIndex);

  return useQuery({
    queryKey: learnKeys.recipesIndex(),
    queryFn: async () => {
      try {
        const raw = await TauriService.fetchRemoteIndex(RECIPES_INDEX_URL);
        const recipes = parsePaperRecipesIndex(raw);
        setRecipesIndex(recipes);
        return recipes;
      } catch (error) {
        logger.warn("Failed to load paper recipes index", { error });
        throw new Error(getCatalogErrorMessage("paper recipe catalog", error));
      }
    },
    staleTime: 5 * 60_000,
    retry: 1,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 3000),
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
      setSampleDataStatus(dataset.id, {
        downloading: true,
        progress: 0,
        errorMessage: null,
      });
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
        errorMessage: null,
      });
      queryClient.invalidateQueries({
        queryKey: learnKeys.downloadedSamples(),
      });
    },
    onError: (error, dataset) => {
      logger.warn("Failed to download sample dataset", {
        datasetId: dataset.id,
        error,
      });
      setSampleDataStatus(dataset.id, {
        downloading: false,
        progress: 0,
        errorMessage: getSampleDownloadErrorMessage(dataset.name, error),
      });
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
        errorMessage: null,
      });
      queryClient.invalidateQueries({
        queryKey: learnKeys.downloadedSamples(),
      });
    },
  });
}
