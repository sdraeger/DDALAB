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

      console.log("[ANNOTATION] After adding annotation, state:", {
        filePath,
        globalAnnotationsCount:
          state.annotations.timeSeries[filePath].globalAnnotations.length,
        globalAnnotations:
          state.annotations.timeSeries[filePath].globalAnnotations,
        annotation,
      });
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
            console.log(
              "[ANNOTATION] Saved to FileStateManager:",
              annotation.id,
            );
          }
        } catch (err) {
          console.error(
            "[ANNOTATION] Failed to save to FileStateManager:",
            err,
          );
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
          Object.assign(arr[index], updates, {
            updatedAt: new Date().toISOString(),
          });
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
            console.log(
              "[ANNOTATION] Updated in FileStateManager:",
              annotationId,
            );
          }
        } catch (err) {
          console.error(
            "[ANNOTATION] Failed to update in FileStateManager:",
            err,
          );
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
          console.log("[ANNOTATION] Deleted from database:", annotationId);

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
            console.log(
              "[ANNOTATION] Deleted from FileStateManager:",
              annotationId,
            );
          }
        } catch (err) {
          console.error("[ANNOTATION] Failed to delete annotation:", err);
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
      console.log(
        "[ANNOTATION] Not in Tauri environment, skipping load all annotations",
      );
      return;
    }

    try {
      console.log(
        "[ANNOTATION] Loading annotations from both SQLite database and FileStateManager...",
      );

      const sqliteAnnotations = await TauriService.getAllAnnotations();
      console.log(
        "[ANNOTATION] Found",
        Object.keys(sqliteAnnotations).length,
        "files with annotations in SQLite database",
      );

      const fileStateManager = getInitializedFileStateManager();
      const trackedFiles = fileStateManager.getTrackedFiles();
      console.log(
        "[ANNOTATION] Found",
        trackedFiles.length,
        "tracked files in FileStateManager",
      );

      const mergedAnnotations: Record<string, TimeSeriesAnnotations> = {};

      for (const [filePath, fileAnnotations] of Object.entries(
        sqliteAnnotations,
      )) {
        const globalCount = fileAnnotations.global_annotations?.length || 0;
        const channelCount = Object.keys(
          fileAnnotations.channel_annotations || {},
        ).length;

        if (globalCount > 0 || channelCount > 0) {
          console.log("[ANNOTATION] Loading from SQLite for file:", filePath, {
            globalCount,
            channelsCount: channelCount,
          });

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
              console.log(
                "[ANNOTATION] Loading from FileStateManager for file:",
                filePath,
                {
                  globalCount: annotationState.timeSeries?.global?.length || 0,
                  channelsCount: Object.keys(
                    annotationState.timeSeries?.channels || {},
                  ).length,
                },
              );

              mergedAnnotations[filePath] = {
                filePath: filePath,
                globalAnnotations: annotationState.timeSeries?.global || [],
                channelAnnotations: annotationState.timeSeries?.channels || {},
              };
            }
          }
        } catch (err) {
          console.error(
            "[ANNOTATION] Failed to load from FileStateManager for file:",
            filePath,
            err,
          );
        }
      }

      set((state) => {
        state.annotations.timeSeries = mergedAnnotations;
      });

      console.log(
        "[ANNOTATION] Finished loading all annotations. Total files with annotations:",
        Object.keys(get().annotations.timeSeries).length,
      );
    } catch (err) {
      console.error("[ANNOTATION] Failed to load all file annotations:", err);
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
          console.log(
            "[ANNOTATION] Saved DDA annotation to FileStateManager:",
            annotation.id,
          );
        } catch (err) {
          console.error(
            "[ANNOTATION] Failed to save DDA annotation to FileStateManager:",
            err,
          );
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
        Object.assign(plotAnnotations.annotations[index], updates, {
          updatedAt: new Date().toISOString(),
        });
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
          console.log(
            "[ANNOTATION] Updated DDA annotation in FileStateManager:",
            annotationId,
          );
        } catch (err) {
          console.error(
            "[ANNOTATION] Failed to update DDA annotation in FileStateManager:",
            err,
          );
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
          console.log(
            "[ANNOTATION] Deleted DDA annotation from FileStateManager:",
            annotationId,
          );
        } catch (err) {
          console.error(
            "[ANNOTATION] Failed to delete DDA annotation from FileStateManager:",
            err,
          );
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
