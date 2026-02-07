import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";

export interface DownloadedDataset {
  id: string;
  datasetId: string;
  name: string;
  path: string;
  downloadedAt: number;
  snapshotTag: string | null;
  modalities: string[];
  subjects: number | undefined;
  size: number | undefined;
}

interface DownloadedDatasetsState {
  datasets: DownloadedDataset[];
  maxDatasets: number;

  addDataset: (dataset: Omit<DownloadedDataset, "id" | "downloadedAt">) => void;
  removeDataset: (id: string) => void;
  clearAll: () => void;
  getByDatasetId: (datasetId: string) => DownloadedDataset | undefined;
  getDownloadedIds: () => Set<string>;
}

export const useDownloadedDatasetsStore = create<DownloadedDatasetsState>()(
  persist(
    immer((set, get) => ({
      datasets: [],
      maxDatasets: 100,

      addDataset: (dataset) => {
        set((state) => {
          // Replace existing entry for the same datasetId
          state.datasets = state.datasets.filter(
            (d) => d.datasetId !== dataset.datasetId,
          );

          state.datasets.unshift({
            ...dataset,
            id: `dl-${crypto.randomUUID()}`,
            downloadedAt: Date.now(),
          });

          if (state.datasets.length > state.maxDatasets) {
            state.datasets = state.datasets.slice(0, state.maxDatasets);
          }
        });
      },

      removeDataset: (id) => {
        set((state) => {
          state.datasets = state.datasets.filter((d) => d.id !== id);
        });
      },

      clearAll: () => {
        set((state) => {
          state.datasets = [];
        });
      },

      getByDatasetId: (datasetId) => {
        return get().datasets.find((d) => d.datasetId === datasetId);
      },

      getDownloadedIds: () => {
        return new Set(get().datasets.map((d) => d.datasetId));
      },
    })),
    {
      name: "ddalab-downloaded-datasets",
      partialize: (state) => ({ datasets: state.datasets }),
    },
  ),
);
