import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";

export interface ExportRecord {
  id: string;
  type: "dda-results" | "plot" | "file" | "annotations";
  format: "csv" | "json" | "png" | "svg" | "pdf" | "edf" | "xdf";
  sourceName: string;
  outputPath: string;
  timestamp: number;
  fileSize?: number;
  status: "success" | "failed";
  error?: string;
  metadata?: {
    analysisId?: string;
    channels?: string[];
    variantName?: string;
  };
}

interface ExportHistoryState {
  exports: ExportRecord[];
  maxExports: number;

  addExport: (record: Omit<ExportRecord, "id" | "timestamp">) => void;
  removeExport: (id: string) => void;
  clearHistory: () => void;
  getExportsByType: (type: ExportRecord["type"]) => ExportRecord[];
  getRecentExports: (limit?: number) => ExportRecord[];
}

export const useExportHistoryStore = create<ExportHistoryState>()(
  persist(
    immer((set, get) => ({
      exports: [],
      maxExports: 100,

      addExport: (record) => {
        const id = `export-${crypto.randomUUID()}`;
        set((state) => {
          state.exports.unshift({
            ...record,
            id,
            timestamp: Date.now(),
          });

          if (state.exports.length > state.maxExports) {
            state.exports = state.exports.slice(0, state.maxExports);
          }
        });
      },

      removeExport: (id) => {
        set((state) => {
          state.exports = state.exports.filter((e) => e.id !== id);
        });
      },

      clearHistory: () => {
        set((state) => {
          state.exports = [];
        });
      },

      getExportsByType: (type) => {
        return get().exports.filter((e) => e.type === type);
      },

      getRecentExports: (limit = 20) => {
        return get().exports.slice(0, limit);
      },
    })),
    {
      name: "ddalab-export-history",
      partialize: (state) => ({ exports: state.exports }),
    },
  ),
);

export const useRecentExports = (limit?: number) =>
  useExportHistoryStore((state) => state.getRecentExports(limit));
export const useExportsByType = (type: ExportRecord["type"]) =>
  useExportHistoryStore((state) => state.getExportsByType(type));
