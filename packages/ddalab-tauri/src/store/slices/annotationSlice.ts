/**
 * Annotation state slice
 */

import { TauriService } from "@/services/tauriService";
import { getInitializedFileStateManager } from "@/services/fileStateInitializer";
import type {
  PlotAnnotation,
  TimeSeriesAnnotations,
} from "@/types/annotations";
import type { FileAnnotationState } from "@/types/fileCentricState";
import type {
  AnnotationSlice,
  AnnotationState,
  ImmerStateCreator,
} from "./types";

export const defaultAnnotationState: AnnotationState = {
  timeSeries: {},
  ddaResults: {},
};

const EMPTY_ANNOTATIONS: PlotAnnotation[] = [];

type AnnotationCache = {
  timeSeries: Record<string, PlotAnnotation[]>;
  dda: Record<string, PlotAnnotation[]>;
};

const annotationCache: AnnotationCache = {
  timeSeries: {},
  dda: {},
};

function getTimeSeriesCacheKey(filePath: string, channel?: string): string {
  return channel ? `${filePath}:${channel}` : filePath;
}

function computeTimeSeriesAnnotations(
  fileAnnotations: TimeSeriesAnnotations | undefined,
  channel?: string,
): PlotAnnotation[] {
  if (!fileAnnotations) return EMPTY_ANNOTATIONS;

  if (channel && fileAnnotations.channelAnnotations?.[channel]) {
    return [
      ...fileAnnotations.globalAnnotations,
      ...fileAnnotations.channelAnnotations[channel],
    ];
  }
  return fileAnnotations.globalAnnotations;
}

function invalidateTimeSeriesCache(filePath: string): void {
  const keysToDelete = Object.keys(annotationCache.timeSeries).filter(
    (key) => key === filePath || key.startsWith(`${filePath}:`),
  );
  for (const key of keysToDelete) {
    delete annotationCache.timeSeries[key];
  }
}

function invalidateDDACache(key: string): void {
  delete annotationCache.dda[key];
}

/**
 * Persist time series annotation changes for a specific file.
 * Only updates the timeSeries portion, preserving existing ddaResults.
 */
async function persistTimeSeriesAnnotation(
  filePath: string,
  fileAnnotations: TimeSeriesAnnotations,
): Promise<void> {
  const fileStateManager = getInitializedFileStateManager();
  const existingState = fileStateManager.getModuleState<FileAnnotationState>(
    filePath,
    "annotations",
  );

  const fileAnnotationState: FileAnnotationState = {
    timeSeries: {
      global: fileAnnotations.globalAnnotations,
      channels: fileAnnotations.channelAnnotations || {},
    },
    ddaResults: existingState?.ddaResults || {},
    lastUpdated: new Date().toISOString(),
  };

  await fileStateManager.updateModuleState(
    filePath,
    "annotations",
    fileAnnotationState,
  );
}

/**
 * Persist DDA annotation changes for a specific key.
 * Only updates the specific ddaResults key, preserving everything else.
 */
async function persistDdaAnnotation(
  filePath: string,
  ddaKey: string,
  annotations: PlotAnnotation[],
  fileTimeSeries: TimeSeriesAnnotations | undefined,
): Promise<void> {
  const fileStateManager = getInitializedFileStateManager();
  const existingState = fileStateManager.getModuleState<FileAnnotationState>(
    filePath,
    "annotations",
  );

  const fileAnnotationState: FileAnnotationState = {
    timeSeries: {
      global:
        fileTimeSeries?.globalAnnotations ||
        existingState?.timeSeries?.global ||
        [],
      channels:
        fileTimeSeries?.channelAnnotations ||
        existingState?.timeSeries?.channels ||
        {},
    },
    ddaResults: {
      ...existingState?.ddaResults,
      [ddaKey]: annotations,
    },
    lastUpdated: new Date().toISOString(),
  };

  await fileStateManager.updateModuleState(
    filePath,
    "annotations",
    fileAnnotationState,
  );
}

export const createAnnotationSlice: ImmerStateCreator<AnnotationSlice> = (
  set,
  get,
) => ({
  annotations: defaultAnnotationState,

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

      invalidateTimeSeriesCache(filePath);
    });

    setTimeout(async () => {
      if (TauriService.isTauri()) {
        try {
          const currentAnnotations = get().annotations;
          const fileAnnotations = currentAnnotations.timeSeries[filePath];

          if (fileAnnotations) {
            await persistTimeSeriesAnnotation(filePath, fileAnnotations);
          }
        } catch {
          // Silent fail - annotation save is handled by primary database
        }
      }
    }, 100);
  },

  updateTimeSeriesAnnotation: (filePath, annotationId, updates, channel) => {
    set((state) => {
      const fileAnnotations = state.annotations.timeSeries[filePath];
      if (!fileAnnotations) return;

      const updateAnnotationInArray = (arr: PlotAnnotation[]) => {
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
        updateAnnotationInArray(fileAnnotations.channelAnnotations[channel]);
      } else {
        updateAnnotationInArray(fileAnnotations.globalAnnotations);
      }

      invalidateTimeSeriesCache(filePath);
    });

    setTimeout(async () => {
      if (TauriService.isTauri()) {
        try {
          const currentAnnotations = get().annotations;
          const fileAnnotations = currentAnnotations.timeSeries[filePath];

          if (fileAnnotations) {
            await persistTimeSeriesAnnotation(filePath, fileAnnotations);
          }
        } catch {
          // Silent fail - annotation update is handled by primary database
        }
      }
    }, 100);
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

      invalidateTimeSeriesCache(filePath);
    });

    setTimeout(async () => {
      if (TauriService.isTauri()) {
        try {
          await TauriService.deleteAnnotation(annotationId);

          const currentAnnotations = get().annotations;
          const fileAnnotations = currentAnnotations.timeSeries[filePath];

          if (fileAnnotations) {
            await persistTimeSeriesAnnotation(filePath, fileAnnotations);
          }
        } catch {
          // Silent fail - annotation will be deleted on next save
        }
      }
    }, 100);
  },

  getTimeSeriesAnnotations: (filePath, channel) => {
    const state = get();
    const fileAnnotations = state.annotations.timeSeries[filePath];

    if (!fileAnnotations) return EMPTY_ANNOTATIONS;

    const cacheKey = getTimeSeriesCacheKey(filePath, channel);
    const cached = annotationCache.timeSeries[cacheKey];
    if (cached !== undefined) {
      return cached;
    }

    const result = computeTimeSeriesAnnotations(fileAnnotations, channel);
    annotationCache.timeSeries[cacheKey] = result;
    return result;
  },

  loadAllFileAnnotations: async () => {
    if (!TauriService.isTauri()) {
      return;
    }

    try {
      const sqliteAnnotations = await TauriService.getAllAnnotations();
      const fileStateManager = getInitializedFileStateManager();
      const trackedFiles = fileStateManager.getTrackedFiles();

      const mergedAnnotations: Record<string, TimeSeriesAnnotations> = {};

      for (const [filePath, fileAnnotations] of Object.entries(
        sqliteAnnotations,
      )) {
        const globalCount = fileAnnotations.global_annotations?.length || 0;
        const channelCount = Object.keys(
          fileAnnotations.channel_annotations || {},
        ).length;

        if (globalCount > 0 || channelCount > 0) {
          const globalAnnotations = fileAnnotations.global_annotations.map(
            (ann) => ({
              ...ann,
              createdAt: new Date().toISOString(),
              visible_in_plots: ann.visible_in_plots || [],
            }),
          );

          const channelAnnotations: Record<string, PlotAnnotation[]> = {};
          for (const [channel, anns] of Object.entries(
            fileAnnotations.channel_annotations || {},
          )) {
            channelAnnotations[channel] = anns.map((ann) => ({
              ...ann,
              createdAt: new Date().toISOString(),
              visible_in_plots: ann.visible_in_plots || [],
            }));
          }

          mergedAnnotations[filePath] = {
            filePath: filePath,
            globalAnnotations,
            channelAnnotations,
          };
        }
      }

      for (const filePath of trackedFiles) {
        if (mergedAnnotations[filePath]) continue;

        try {
          const moduleState = fileStateManager.getModuleState(
            filePath,
            "annotations",
          );
          if (moduleState) {
            const annotationState = moduleState as FileAnnotationState;
            const hasAnnotations =
              annotationState &&
              ((annotationState.timeSeries?.global?.length || 0) > 0 ||
                Object.keys(annotationState.timeSeries?.channels || {}).length >
                  0);

            if (hasAnnotations) {
              mergedAnnotations[filePath] = {
                filePath: filePath,
                globalAnnotations: annotationState.timeSeries?.global || [],
                channelAnnotations: annotationState.timeSeries?.channels || {},
              };
            }
          }
        } catch {
          // Silent fail for individual file
        }
      }

      set((state) => {
        state.annotations.timeSeries = mergedAnnotations;
      });

      annotationCache.timeSeries = {};
    } catch {
      // Silent fail - annotations unavailable
    }
  },

  addDDAAnnotation: (resultId, variantId, plotType, annotation) => {
    set((state) => {
      const key = `${resultId}_${variantId}_${plotType}`;

      if (!state.annotations.ddaResults[key]) {
        state.annotations.ddaResults[key] = {
          resultId,
          variantId,
          plotType,
          annotations: [],
        };
      }

      state.annotations.ddaResults[key].annotations.push(annotation);

      invalidateDDACache(key);
    });

    setTimeout(async () => {
      const { fileManager } = get();
      if (TauriService.isTauri() && fileManager.selectedFile) {
        try {
          const key = `${resultId}_${variantId}_${plotType}`;
          const currentAnnotations = get().annotations;
          const filePath = fileManager.selectedFile.file_path;
          const fileTimeSeries = currentAnnotations.timeSeries[filePath];
          const ddaAnnotations =
            currentAnnotations.ddaResults[key]?.annotations || [];

          await persistDdaAnnotation(
            filePath,
            key,
            ddaAnnotations,
            fileTimeSeries,
          );
        } catch {
          // Silent fail - DDA annotation save is non-critical
        }
      }
    }, 100);
  },

  updateDDAAnnotation: (
    resultId,
    variantId,
    plotType,
    annotationId,
    updates,
  ) => {
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

      invalidateDDACache(key);
    });

    setTimeout(async () => {
      const { fileManager } = get();
      if (TauriService.isTauri() && fileManager.selectedFile) {
        try {
          const currentAnnotations = get().annotations;
          const filePath = fileManager.selectedFile.file_path;
          const fileTimeSeries = currentAnnotations.timeSeries[filePath];
          const ddaAnnotations =
            currentAnnotations.ddaResults[key]?.annotations || [];

          await persistDdaAnnotation(
            filePath,
            key,
            ddaAnnotations,
            fileTimeSeries,
          );
        } catch {
          // Silent fail - DDA annotation update is non-critical
        }
      }
    }, 100);
  },

  deleteDDAAnnotation: (resultId, variantId, plotType, annotationId) => {
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

      invalidateDDACache(key);
    });

    setTimeout(async () => {
      const { fileManager } = get();
      if (TauriService.isTauri() && fileManager.selectedFile) {
        try {
          const currentAnnotations = get().annotations;
          const filePath = fileManager.selectedFile.file_path;
          const fileTimeSeries = currentAnnotations.timeSeries[filePath];
          const ddaAnnotations =
            currentAnnotations.ddaResults[key]?.annotations || [];

          await persistDdaAnnotation(
            filePath,
            key,
            ddaAnnotations,
            fileTimeSeries,
          );
        } catch {
          // Silent fail - DDA annotation delete is non-critical
        }
      }
    }, 100);
  },

  getDDAAnnotations: (resultId, variantId, plotType) => {
    const key = `${resultId}_${variantId}_${plotType}`;

    const cached = annotationCache.dda[key];
    if (cached !== undefined) {
      return cached;
    }

    const state = get();
    const annotations = state.annotations.ddaResults[key]?.annotations;

    if (!annotations) {
      annotationCache.dda[key] = EMPTY_ANNOTATIONS;
      return EMPTY_ANNOTATIONS;
    }

    annotationCache.dda[key] = annotations;
    return annotations;
  },
});
