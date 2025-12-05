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
    });

    setTimeout(async () => {
      if (TauriService.isTauri()) {
        try {
          const fileStateManager = getInitializedFileStateManager();
          const currentAnnotations = get().annotations;
          const fileAnnotations = currentAnnotations.timeSeries[filePath];

          if (fileAnnotations) {
            const ddaResultsForFile: Record<string, PlotAnnotation[]> = {};
            Object.entries(currentAnnotations.ddaResults).forEach(
              ([key, value]) => {
                ddaResultsForFile[key] = value.annotations;
              },
            );

            const fileAnnotationState: FileAnnotationState = {
              timeSeries: {
                global: fileAnnotations.globalAnnotations,
                channels: fileAnnotations.channelAnnotations || {},
              },
              ddaResults: ddaResultsForFile,
              lastUpdated: new Date().toISOString(),
            };

            await fileStateManager.updateModuleState(
              filePath,
              "annotations",
              fileAnnotationState,
            );
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
    });

    setTimeout(async () => {
      if (TauriService.isTauri()) {
        try {
          const fileStateManager = getInitializedFileStateManager();
          const currentAnnotations = get().annotations;
          const fileAnnotations = currentAnnotations.timeSeries[filePath];

          if (fileAnnotations) {
            const ddaResultsForFile: Record<string, PlotAnnotation[]> = {};
            Object.entries(currentAnnotations.ddaResults).forEach(
              ([key, value]) => {
                ddaResultsForFile[key] = value.annotations;
              },
            );

            const fileAnnotationState: FileAnnotationState = {
              timeSeries: {
                global: fileAnnotations.globalAnnotations,
                channels: fileAnnotations.channelAnnotations || {},
              },
              ddaResults: ddaResultsForFile,
              lastUpdated: new Date().toISOString(),
            };

            await fileStateManager.updateModuleState(
              filePath,
              "annotations",
              fileAnnotationState,
            );
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
    });

    setTimeout(async () => {
      if (TauriService.isTauri()) {
        try {
          await TauriService.deleteAnnotation(annotationId);

          const fileStateManager = getInitializedFileStateManager();
          const currentAnnotations = get().annotations;
          const fileAnnotations = currentAnnotations.timeSeries[filePath];

          if (fileAnnotations) {
            const ddaResultsForFile: Record<string, PlotAnnotation[]> = {};
            Object.entries(currentAnnotations.ddaResults).forEach(
              ([key, value]) => {
                ddaResultsForFile[key] = value.annotations;
              },
            );

            const fileAnnotationState: FileAnnotationState = {
              timeSeries: {
                global: fileAnnotations.globalAnnotations,
                channels: fileAnnotations.channelAnnotations || {},
              },
              ddaResults: ddaResultsForFile,
              lastUpdated: new Date().toISOString(),
            };

            await fileStateManager.updateModuleState(
              filePath,
              "annotations",
              fileAnnotationState,
            );
          }
        } catch (err) {
          console.error("Failed to delete annotation:", err);
        }
      }
    }, 100);
  },

  getTimeSeriesAnnotations: (filePath, channel) => {
    const state = get();
    const fileAnnotations = state.annotations.timeSeries[filePath];

    if (!fileAnnotations) return [];

    if (channel && fileAnnotations.channelAnnotations?.[channel]) {
      return [
        ...fileAnnotations.globalAnnotations,
        ...fileAnnotations.channelAnnotations[channel],
      ];
    }
    return fileAnnotations.globalAnnotations;
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
    } catch (err) {
      console.error("Failed to load annotations:", err);
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
    });

    setTimeout(async () => {
      const { fileManager } = get();
      if (TauriService.isTauri() && fileManager.selectedFile) {
        try {
          const fileStateManager = getInitializedFileStateManager();
          const currentAnnotations = get().annotations;
          const filePath = fileManager.selectedFile.file_path;
          const fileTimeSeries = currentAnnotations.timeSeries[filePath];

          const ddaResultsForFile: Record<string, PlotAnnotation[]> = {};
          Object.entries(currentAnnotations.ddaResults).forEach(
            ([key, value]) => {
              ddaResultsForFile[key] = value.annotations;
            },
          );

          const fileAnnotationState: FileAnnotationState = {
            timeSeries: {
              global: fileTimeSeries?.globalAnnotations || [],
              channels: fileTimeSeries?.channelAnnotations || {},
            },
            ddaResults: ddaResultsForFile,
            lastUpdated: new Date().toISOString(),
          };

          await fileStateManager.updateModuleState(
            filePath,
            "annotations",
            fileAnnotationState,
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
    set((state) => {
      const key = `${resultId}_${variantId}_${plotType}`;
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

    setTimeout(async () => {
      const { fileManager } = get();
      if (TauriService.isTauri() && fileManager.selectedFile) {
        try {
          const fileStateManager = getInitializedFileStateManager();
          const currentAnnotations = get().annotations;
          const filePath = fileManager.selectedFile.file_path;
          const fileTimeSeries = currentAnnotations.timeSeries[filePath];

          const ddaResultsForFile: Record<string, PlotAnnotation[]> = {};
          Object.entries(currentAnnotations.ddaResults).forEach(
            ([key, value]) => {
              ddaResultsForFile[key] = value.annotations;
            },
          );

          const fileAnnotationState: FileAnnotationState = {
            timeSeries: {
              global: fileTimeSeries?.globalAnnotations || [],
              channels: fileTimeSeries?.channelAnnotations || {},
            },
            ddaResults: ddaResultsForFile,
            lastUpdated: new Date().toISOString(),
          };

          await fileStateManager.updateModuleState(
            filePath,
            "annotations",
            fileAnnotationState,
          );
        } catch {
          // Silent fail - DDA annotation update is non-critical
        }
      }
    }, 100);
  },

  deleteDDAAnnotation: (resultId, variantId, plotType, annotationId) => {
    set((state) => {
      const key = `${resultId}_${variantId}_${plotType}`;
      const plotAnnotations = state.annotations.ddaResults[key];

      if (!plotAnnotations) return;

      const index = plotAnnotations.annotations.findIndex(
        (a) => a.id === annotationId,
      );
      if (index !== -1) {
        plotAnnotations.annotations.splice(index, 1);
      }
    });

    setTimeout(async () => {
      const { fileManager } = get();
      if (TauriService.isTauri() && fileManager.selectedFile) {
        try {
          const fileStateManager = getInitializedFileStateManager();
          const currentAnnotations = get().annotations;
          const filePath = fileManager.selectedFile.file_path;
          const fileTimeSeries = currentAnnotations.timeSeries[filePath];

          const ddaResultsForFile: Record<string, PlotAnnotation[]> = {};
          Object.entries(currentAnnotations.ddaResults).forEach(
            ([key, value]) => {
              ddaResultsForFile[key] = value.annotations;
            },
          );

          const fileAnnotationState: FileAnnotationState = {
            timeSeries: {
              global: fileTimeSeries?.globalAnnotations || [],
              channels: fileTimeSeries?.channelAnnotations || {},
            },
            ddaResults: ddaResultsForFile,
            lastUpdated: new Date().toISOString(),
          };

          await fileStateManager.updateModuleState(
            filePath,
            "annotations",
            fileAnnotationState,
          );
        } catch {
          // Silent fail - DDA annotation delete is non-critical
        }
      }
    }, 100);
  },

  getDDAAnnotations: (resultId, variantId, plotType) => {
    const state = get();
    const key = `${resultId}_${variantId}_${plotType}`;
    return state.annotations.ddaResults[key]?.annotations || [];
  },
});
