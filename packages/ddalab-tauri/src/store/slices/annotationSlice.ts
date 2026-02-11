/**
 * Annotation state slice
 *
 * Single persistence pipeline via FileStateManager (debounced per-file).
 * No module-level cache — hooks compute merged annotations via useMemo.
 */

import { getInitializedFileStateManager } from "@/services/fileStateInitializer";
import { debouncedUpdate } from "@/utils/debounce";
import { toast } from "@/components/ui/toaster";
import type { PlotAnnotation } from "@/types/annotations";
import type { FileAnnotationState } from "@/types/fileCentricState";
import type {
  AnnotationSlice,
  AnnotationState,
  AppState,
  ImmerStateCreator,
} from "./types";

export const defaultAnnotationState: AnnotationState = {
  timeSeries: {},
  ddaResults: {},
  persistenceStatus: {
    pendingSaveCount: 0,
    lastSaveError: null,
    lastSavedAt: null,
  },
};

const EMPTY_ANNOTATIONS: PlotAnnotation[] = [];

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

type SetFn = (fn: (state: AppState) => void) => void;
type GetFn = () => AppState;

function collectDDAResultsForFile(
  state: AppState,
  filePath: string,
): Record<string, PlotAnnotation[]> {
  const fileAnalysisIds = new Set<string>();
  for (const analysis of state.dda.analysisHistory) {
    if (analysis.file_path === filePath) {
      fileAnalysisIds.add(analysis.id);
    }
  }

  const ddaResults: Record<string, PlotAnnotation[]> = {};
  for (const [key, entry] of Object.entries(state.annotations.ddaResults)) {
    if (fileAnalysisIds.has(entry.resultId)) {
      ddaResults[key] = entry.annotations;
    }
  }
  return ddaResults;
}

function scheduleAnnotationPersist(
  filePath: string,
  get: GetFn,
  set: SetFn,
): void {
  set((state) => {
    state.annotations.persistenceStatus.pendingSaveCount++;
  });

  debouncedUpdate(
    `annotation-persist:${filePath}`,
    async () => {
      try {
        const state = get();
        const fileTimeSeries = state.annotations.timeSeries[filePath];

        const fileAnnotationState: FileAnnotationState = {
          timeSeries: {
            global: fileTimeSeries?.globalAnnotations || [],
            channels: fileTimeSeries?.channelAnnotations || {},
          },
          ddaResults: collectDDAResultsForFile(state, filePath),
          lastUpdated: new Date().toISOString(),
        };

        const fileStateManager = getInitializedFileStateManager();
        await fileStateManager.updateModuleState(
          filePath,
          "annotations",
          fileAnnotationState,
        );

        set((state) => {
          state.annotations.persistenceStatus.pendingSaveCount--;
          state.annotations.persistenceStatus.lastSavedAt =
            new Date().toISOString();
          state.annotations.persistenceStatus.lastSaveError = null;
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save annotations";
        toast.warning("Annotation Save Failed", message);
        set((state) => {
          state.annotations.persistenceStatus.pendingSaveCount--;
          state.annotations.persistenceStatus.lastSaveError = message;
        });
      }
    },
    300,
  );
}

/**
 * One-time migration: load annotations from SQLite annotation_db
 * for files that have no FileStateManager data yet.
 */
async function migrateFromSqlite(
  filePath: string,
): Promise<FileAnnotationState | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const dbAnnotations = await invoke<{
      global_annotations: Array<{
        id: string;
        position: number;
        label: string;
        color?: string;
        description?: string;
        visible_in_plots: string[];
      }>;
      channel_annotations: Record<
        string,
        Array<{
          id: string;
          position: number;
          label: string;
          color?: string;
          description?: string;
          visible_in_plots: string[];
        }>
      >;
    }>("get_file_annotations", { filePath });

    const hasData =
      dbAnnotations.global_annotations.length > 0 ||
      Object.keys(dbAnnotations.channel_annotations).length > 0;

    if (!hasData) return null;

    const globalAnnotations: PlotAnnotation[] =
      dbAnnotations.global_annotations.map((ann) => ({
        ...ann,
        createdAt: new Date().toISOString(),
        visible_in_plots: ann.visible_in_plots || [],
      }));

    const channelAnnotations: Record<string, PlotAnnotation[]> = {};
    for (const [channel, anns] of Object.entries(
      dbAnnotations.channel_annotations,
    )) {
      channelAnnotations[channel] = anns.map((ann) => ({
        ...ann,
        createdAt: new Date().toISOString(),
        visible_in_plots: ann.visible_in_plots || [],
      }));
    }

    const migrated: FileAnnotationState = {
      timeSeries: { global: globalAnnotations, channels: channelAnnotations },
      ddaResults: {},
      lastUpdated: new Date().toISOString(),
    };

    const fileStateManager = getInitializedFileStateManager();
    await fileStateManager.updateModuleState(filePath, "annotations", migrated);

    return migrated;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

export const createAnnotationSlice: ImmerStateCreator<AnnotationSlice> = (
  set,
  get,
) => ({
  annotations: defaultAnnotationState,

  // ---- Time Series CRUD ---------------------------------------------------

  addTimeSeriesAnnotation: (filePath, annotation, channel) => {
    set((state) => {
      if (!state.annotations.timeSeries[filePath]) {
        state.annotations.timeSeries[filePath] = {
          filePath,
          globalAnnotations: [],
          channelAnnotations: {},
        };
      }

      if (channel) {
        if (!state.annotations.timeSeries[filePath].channelAnnotations) {
          state.annotations.timeSeries[filePath].channelAnnotations = {};
        }
        if (
          !state.annotations.timeSeries[filePath].channelAnnotations![channel]
        ) {
          state.annotations.timeSeries[filePath].channelAnnotations![channel] =
            [];
        }
        state.annotations.timeSeries[filePath].channelAnnotations![
          channel
        ].push(annotation);
      } else {
        state.annotations.timeSeries[filePath].globalAnnotations.push(
          annotation,
        );
      }
    });

    scheduleAnnotationPersist(filePath, get, set);
  },

  updateTimeSeriesAnnotation: (filePath, annotationId, updates, channel) => {
    set((state) => {
      const fileAnnotations = state.annotations.timeSeries[filePath];
      if (!fileAnnotations) return;

      const updateInArray = (arr: PlotAnnotation[]) => {
        const index = arr.findIndex((a) => a.id === annotationId);
        if (index !== -1) {
          arr[index] = {
            ...arr[index],
            ...updates,
            updatedAt: new Date().toISOString(),
          };
        }
      };

      if (channel && fileAnnotations.channelAnnotations?.[channel]) {
        updateInArray(fileAnnotations.channelAnnotations[channel]);
      } else {
        updateInArray(fileAnnotations.globalAnnotations);
      }
    });

    scheduleAnnotationPersist(filePath, get, set);
  },

  deleteTimeSeriesAnnotation: (filePath, annotationId, channel) => {
    set((state) => {
      const fileAnnotations = state.annotations.timeSeries[filePath];
      if (!fileAnnotations) return;

      if (channel && fileAnnotations.channelAnnotations?.[channel]) {
        const index = fileAnnotations.channelAnnotations[channel].findIndex(
          (a) => a.id === annotationId,
        );
        if (index !== -1) {
          fileAnnotations.channelAnnotations[channel].splice(index, 1);
        }
      } else {
        const index = fileAnnotations.globalAnnotations.findIndex(
          (a) => a.id === annotationId,
        );
        if (index !== -1) {
          fileAnnotations.globalAnnotations.splice(index, 1);
        }
      }
    });

    scheduleAnnotationPersist(filePath, get, set);
  },

  getTimeSeriesAnnotations: (filePath, channel) => {
    const state = get();
    const fileAnnotations = state.annotations.timeSeries[filePath];
    if (!fileAnnotations) return EMPTY_ANNOTATIONS;

    if (channel && fileAnnotations.channelAnnotations?.[channel]) {
      return [
        ...fileAnnotations.globalAnnotations,
        ...fileAnnotations.channelAnnotations[channel],
      ];
    }
    return fileAnnotations.globalAnnotations;
  },

  // ---- DDA CRUD -----------------------------------------------------------

  addDDAAnnotation: (resultId, variantId, plotType, annotation) => {
    const filePath = get().fileManager.selectedFile?.file_path;
    const key = `${resultId}_${variantId}_${plotType}`;

    set((state) => {
      if (!state.annotations.ddaResults[key]) {
        state.annotations.ddaResults[key] = {
          resultId,
          variantId,
          plotType,
          annotations: [],
        };
      }
      state.annotations.ddaResults[key].annotations.push(annotation);
    });

    if (filePath) {
      scheduleAnnotationPersist(filePath, get, set);
    }
  },

  updateDDAAnnotation: (
    resultId,
    variantId,
    plotType,
    annotationId,
    updates,
  ) => {
    const filePath = get().fileManager.selectedFile?.file_path;
    const key = `${resultId}_${variantId}_${plotType}`;

    set((state) => {
      const plotAnnotations = state.annotations.ddaResults[key];
      if (!plotAnnotations) return;

      const index = plotAnnotations.annotations.findIndex(
        (a) => a.id === annotationId,
      );
      if (index !== -1) {
        plotAnnotations.annotations[index] = {
          ...plotAnnotations.annotations[index],
          ...updates,
          updatedAt: new Date().toISOString(),
        };
      }
    });

    if (filePath) {
      scheduleAnnotationPersist(filePath, get, set);
    }
  },

  deleteDDAAnnotation: (resultId, variantId, plotType, annotationId) => {
    const filePath = get().fileManager.selectedFile?.file_path;
    const key = `${resultId}_${variantId}_${plotType}`;

    set((state) => {
      const plotAnnotations = state.annotations.ddaResults[key];
      if (!plotAnnotations) return;

      const index = plotAnnotations.annotations.findIndex(
        (a) => a.id === annotationId,
      );
      if (index !== -1) {
        plotAnnotations.annotations.splice(index, 1);
      }
    });

    if (filePath) {
      scheduleAnnotationPersist(filePath, get, set);
    }
  },

  getDDAAnnotations: (resultId, variantId, plotType) => {
    const key = `${resultId}_${variantId}_${plotType}`;
    const state = get();
    return state.annotations.ddaResults[key]?.annotations || EMPTY_ANNOTATIONS;
  },

  // ---- Loading & Persistence -----------------------------------------------

  loadFileAnnotations: async (filePath) => {
    try {
      const fileStateManager = getInitializedFileStateManager();
      let annotationState =
        fileStateManager.getModuleState<FileAnnotationState>(
          filePath,
          "annotations",
        );

      // One-time migration from SQLite annotation_db
      if (!annotationState) {
        annotationState = await migrateFromSqlite(filePath);
      }

      if (!annotationState) return;

      const hasTimeSeries =
        (annotationState.timeSeries?.global?.length || 0) > 0 ||
        Object.keys(annotationState.timeSeries?.channels || {}).length > 0;
      const hasDDA = Object.keys(annotationState.ddaResults || {}).length > 0;

      if (!hasTimeSeries && !hasDDA) return;

      set((state) => {
        if (hasTimeSeries) {
          state.annotations.timeSeries[filePath] = {
            filePath,
            globalAnnotations: annotationState!.timeSeries?.global || [],
            channelAnnotations: annotationState!.timeSeries?.channels || {},
          };
        }

        if (hasDDA) {
          for (const [key, plotAnnotations] of Object.entries(
            annotationState!.ddaResults,
          )) {
            const parts = key.split("_");
            if (parts.length >= 3) {
              const plotType = parts[parts.length - 1] as "heatmap" | "line";
              const variantId = parts[parts.length - 2];
              const resultId = parts.slice(0, parts.length - 2).join("_");
              state.annotations.ddaResults[key] = {
                resultId,
                variantId,
                plotType,
                annotations: plotAnnotations,
              };
            }
          }
        }
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load annotations";
      toast.warning("Annotation Load Failed", message);
    }
  },

  flushPendingSaves: async () => {
    // The debouncedUpdate timers fire on their own schedule.
    // This is a best-effort flush: wait for any in-flight debounced writes
    // to settle by allowing the event loop to drain.
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
  },
});
