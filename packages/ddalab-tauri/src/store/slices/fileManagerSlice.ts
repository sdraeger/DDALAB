/**
 * File Manager state slice
 */

import { TauriService } from "@/services/tauriService";
import { getInitializedFileStateManager } from "@/services/fileStateInitializer";
import { getStatePersistenceService } from "@/services/statePersistenceService";
import { handleError } from "@/utils/errorHandler";
import type {
  FilePlotState,
  FileDDAState,
  FileAnnotationState,
} from "@/types/fileCentricState";
import type { PlotAnnotation } from "@/types/annotations";
import type {
  FileManagerSlice,
  FileManagerState,
  ImmerStateCreator,
} from "./types";

export const defaultFileManagerState: FileManagerState = {
  dataDirectoryPath: "",
  currentPath: [],
  selectedFile: null,
  selectedChannels: [],
  timeWindow: { start: 0, end: 30 },
  searchQuery: "",
  sortBy: "name",
  sortOrder: "asc",
  showHidden: false,
  pendingFileSelection: null,
  highlightedFilePath: null,
};

/** Serializes FileManagerState to the format expected by TauriService */
function serializeFileManagerState(
  fm: FileManagerState,
  overrides?: Partial<{
    data_directory_path: string;
    selected_file: string | null;
    current_path: string[];
    selected_channels: string[];
  }>,
) {
  return {
    data_directory_path: overrides?.data_directory_path ?? fm.dataDirectoryPath,
    selected_file:
      overrides?.selected_file !== undefined
        ? overrides.selected_file
        : fm.selectedFile?.file_path || null,
    current_path: overrides?.current_path ?? fm.currentPath,
    selected_channels: overrides?.selected_channels ?? fm.selectedChannels,
    search_query: fm.searchQuery,
    sort_by: fm.sortBy,
    sort_order: fm.sortOrder,
    show_hidden: fm.showHidden,
  };
}

/** Persists file manager state to Tauri and optional persistence service */
function persistFileManagerState(
  fileManagerState: ReturnType<typeof serializeFileManagerState>,
  persistenceService: ReturnType<typeof getStatePersistenceService>,
) {
  TauriService.updateFileManagerState(fileManagerState).catch((error) =>
    handleError(error, {
      source: "File Manager Persistence",
      severity: "silent",
    }),
  );

  if (persistenceService) {
    persistenceService.saveFileManagerState(fileManagerState).catch((error) =>
      handleError(error, {
        source: "File Manager Persistence",
        severity: "silent",
      }),
    );
  }
}

export const createFileManagerSlice: ImmerStateCreator<FileManagerSlice> = (
  set,
  get,
) => ({
  fileManager: defaultFileManagerState,

  setDataDirectoryPath: (path) => {
    set((state) => {
      state.fileManager.dataDirectoryPath = path;
    });

    if (TauriService.isTauri()) {
      const { fileManager, isPersistenceRestored } = get();
      if (!isPersistenceRestored) return;

      const state = serializeFileManagerState(fileManager, {
        data_directory_path: path,
      });
      persistFileManagerState(state, getStatePersistenceService());
    }
  },

  setCurrentPath: (path) => {
    set((state) => {
      state.fileManager.currentPath = path;
    });

    if (TauriService.isTauri()) {
      const { fileManager, isPersistenceRestored } = get();
      if (!isPersistenceRestored) return;

      const state = serializeFileManagerState(fileManager, {
        current_path: path,
      });
      persistFileManagerState(state, getStatePersistenceService());
    }
  },

  resetCurrentPathSync: async () => {
    set((state) => {
      state.fileManager.currentPath = [];
    });

    if (TauriService.isTauri()) {
      const { fileManager } = get();
      const persistenceService = getStatePersistenceService();
      const state = serializeFileManagerState(fileManager, {
        selected_file: null,
        current_path: [],
      });

      TauriService.updateFileManagerState(state).catch((error) =>
        handleError(error, {
          source: "File Manager Persistence",
          severity: "silent",
        }),
      );

      if (persistenceService) {
        await persistenceService.saveFileManagerState(state);
        await persistenceService.forceSave();
      }
    }
  },

  setSelectedFile: (file) => {
    set((state) => {
      state.dda.currentAnalysis = null;
      state.dda.analysisHistory = [];
      state.fileManager.selectedFile = file;
      state.plot.chunkStart = 0;
      state.fileManager.selectedChannels = [];
    });

    if (file && TauriService.isTauri()) {
      (async () => {
        try {
          const fileStateManager = getInitializedFileStateManager();
          const fileState = await fileStateManager.loadFileState(
            file.file_path,
          );

          if (fileState.plot) {
            const plotState = fileState.plot as FilePlotState;
            const chunkStartTime =
              (plotState.chunkStart || 0) / file.sample_rate;
            const isOutOfBounds = chunkStartTime >= file.duration;

            set((state) => {
              state.plot.chunkStart = isOutOfBounds
                ? 0
                : plotState.chunkStart || 0;
              state.plot.chunkSize = plotState.chunkSize || 8192;
              state.plot.amplitude = plotState.amplitude || 1.0;
              state.plot.showAnnotations = plotState.showAnnotations ?? true;
              state.plot.preprocessing = plotState.preprocessing;
              state.plot.selectedChannelColors = plotState.channelColors || {};
              state.fileManager.selectedChannels =
                plotState.selectedChannels || [];
            });
          } else {
            set((state) => {
              state.plot.chunkStart = 0;
              state.plot.chunkSize = state.plot.chunkSize || 8192;
              state.fileManager.selectedChannels = [];
            });
          }

          if (fileState.dda) {
            const ddaState = fileState.dda as FileDDAState;

            set((state) => {
              if (ddaState.lastParameters) {
                Object.assign(
                  state.dda.analysisParameters,
                  ddaState.lastParameters,
                );
              }
              state.dda.currentAnalysis = null;
              state.dda.analysisHistory = [];
            });
          } else {
            set((state) => {
              state.dda.currentAnalysis = null;
              state.dda.analysisHistory = [];
            });
          }

          const annotationState = fileState.annotations as
            | FileAnnotationState
            | undefined;

          (async () => {
            try {
              let mergedGlobalAnnotations: PlotAnnotation[] = [];
              let mergedChannelAnnotations: Record<string, PlotAnnotation[]> =
                {};

              if (annotationState?.timeSeries) {
                const fsGlobal = annotationState.timeSeries.global || [];
                const fsChannels = annotationState.timeSeries.channels || {};

                mergedGlobalAnnotations = [...fsGlobal];
                mergedChannelAnnotations = { ...fsChannels };
              }

              const { invoke } = await import("@tauri-apps/api/core");
              const sqliteAnnotations = await invoke<any>(
                "get_file_annotations",
                { filePath: file.file_path },
              );

              if (sqliteAnnotations) {
                const sqliteGlobal = sqliteAnnotations.global_annotations || [];
                const sqliteChannels =
                  sqliteAnnotations.channel_annotations || {};

                const existingIds = new Set(
                  mergedGlobalAnnotations.map((a) => a.id),
                );
                for (const sqliteAnn of sqliteGlobal) {
                  if (!existingIds.has(sqliteAnn.id)) {
                    mergedGlobalAnnotations.push({
                      id: sqliteAnn.id,
                      position: sqliteAnn.position,
                      label: sqliteAnn.label,
                      color: sqliteAnn.color || "#ef4444",
                      description: sqliteAnn.description,
                      createdAt:
                        sqliteAnn.created_at || new Date().toISOString(),
                      updatedAt:
                        sqliteAnn.updated_at || new Date().toISOString(),
                    });
                  }
                }

                for (const [channel, sqliteAnns] of Object.entries(
                  sqliteChannels,
                )) {
                  if (!mergedChannelAnnotations[channel]) {
                    mergedChannelAnnotations[channel] = [];
                  }
                  const channelExistingIds = new Set(
                    mergedChannelAnnotations[channel].map((a) => a.id),
                  );
                  for (const sqliteAnn of sqliteAnns as any[]) {
                    if (!channelExistingIds.has(sqliteAnn.id)) {
                      mergedChannelAnnotations[channel].push({
                        id: sqliteAnn.id,
                        position: sqliteAnn.position,
                        label: sqliteAnn.label,
                        color: sqliteAnn.color || "#ef4444",
                        description: sqliteAnn.description,
                        createdAt:
                          sqliteAnn.created_at || new Date().toISOString(),
                        updatedAt:
                          sqliteAnn.updated_at || new Date().toISOString(),
                      });
                    }
                  }
                }
              }

              set((state) => {
                state.annotations.timeSeries[file.file_path] = {
                  filePath: file.file_path,
                  globalAnnotations: mergedGlobalAnnotations,
                  channelAnnotations: mergedChannelAnnotations,
                };

                if (annotationState?.ddaResults) {
                  Object.entries(annotationState.ddaResults).forEach(
                    ([key, plotAnnotations]) => {
                      const parts = key.split("_");
                      if (parts.length >= 3) {
                        const plotType = parts[parts.length - 1] as
                          | "heatmap"
                          | "line";
                        const variantId = parts[parts.length - 2];
                        const resultId = parts
                          .slice(0, parts.length - 2)
                          .join("_");

                        state.annotations.ddaResults[key] = {
                          resultId,
                          variantId,
                          plotType,
                          annotations: plotAnnotations,
                        };
                      }
                    },
                  );
                }
              });
            } catch (err) {
              handleError(err, {
                source: "Annotation Loading",
                severity: "silent",
              });

              if (annotationState?.timeSeries) {
                set((state) => {
                  state.annotations.timeSeries[file.file_path] = {
                    filePath: file.file_path,
                    globalAnnotations: annotationState.timeSeries?.global || [],
                    channelAnnotations:
                      annotationState.timeSeries?.channels || {},
                  };
                });
              } else {
                set((state) => {
                  state.annotations.timeSeries[file.file_path] = {
                    filePath: file.file_path,
                    globalAnnotations: [],
                    channelAnnotations: {},
                  };
                });
              }
            }
          })();

          const { fileManager: updatedFileManager, isPersistenceRestored } =
            get();

          const state = serializeFileManagerState(updatedFileManager, {
            selected_file: file?.file_path || null,
          });
          TauriService.updateFileManagerState(state).catch((error) =>
            handleError(error, {
              source: "File Manager Persistence",
              severity: "silent",
            }),
          );

          if (isPersistenceRestored) {
            get()
              .saveCurrentState()
              .catch((err) =>
                handleError(err, {
                  source: "File Manager Persistence",
                  severity: "silent",
                }),
              );
          }
        } catch (err) {
          handleError(err, {
            source: "File State Loading",
            severity: "silent",
          });
        }
      })();
    }
  },

  setSelectedChannels: (channels) => {
    set((state) => {
      state.fileManager.selectedChannels = channels;
    });

    if (TauriService.isTauri()) {
      const { fileManager, plot, isPersistenceRestored } = get();

      if (!isPersistenceRestored) {
        return;
      }

      const selectedFilePath = fileManager.selectedFile?.file_path;
      if (selectedFilePath) {
        (async () => {
          try {
            const fileStateManager = getInitializedFileStateManager();
            const filePlotState: FilePlotState = {
              chunkStart: plot.chunkStart,
              chunkSize: plot.chunkSize,
              selectedChannels: channels,
              amplitude: plot.amplitude,
              showAnnotations: plot.showAnnotations,
              preprocessing: plot.preprocessing,
              channelColors: plot.selectedChannelColors,
              lastUpdated: new Date().toISOString(),
            };

            await fileStateManager.updateModuleState(
              selectedFilePath,
              "plot",
              filePlotState,
            );
          } catch (err) {
            handleError(err, {
              source: "File State Persistence",
              severity: "silent",
            });
          }
        })();
      }

      const state = serializeFileManagerState(fileManager, {
        selected_channels: channels,
      });
      TauriService.updateFileManagerState(state).catch((error) =>
        handleError(error, {
          source: "File Manager Persistence",
          severity: "silent",
        }),
      );
    }
  },

  setTimeWindow: (window) => {
    set((state) => {
      state.fileManager.timeWindow = window;
    });
  },

  updateFileManagerState: (updates) => {
    set((state) => {
      state.fileManager = { ...state.fileManager, ...updates };
    });

    if (TauriService.isTauri()) {
      const { fileManager } = get();
      const state = serializeFileManagerState(fileManager);
      TauriService.updateFileManagerState(state).catch((error) =>
        handleError(error, {
          source: "File Manager Persistence",
          severity: "silent",
        }),
      );
    }
  },

  clearPendingFileSelection: () => {
    set((state) => {
      state.fileManager.pendingFileSelection = null;
    });
  },

  navigateToFile: (filePath: string) => {
    const { fileManager } = get();
    const dataDir = fileManager.dataDirectoryPath;

    if (!filePath || !dataDir) return;
    if (!filePath.startsWith(dataDir)) return;

    const lastSlash = filePath.lastIndexOf("/");
    const fileDir = lastSlash > 0 ? filePath.substring(0, lastSlash) : filePath;

    const relativePath = fileDir.substring(dataDir.length);
    const pathSegments = relativePath.split("/").filter(Boolean);

    set((state) => {
      state.fileManager.currentPath = pathSegments;
      state.fileManager.highlightedFilePath = filePath;
    });

    setTimeout(() => {
      get().clearHighlightedFile();
    }, 3000);
  },

  clearHighlightedFile: () => {
    set((state) => {
      state.fileManager.highlightedFilePath = null;
    });
  },
});
