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
      const persistenceService = getStatePersistenceService();

      if (!isPersistenceRestored) {
        console.log(
          "[STORE] Skipping save during initialization - data directory path set to:",
          path,
        );
        return;
      }

      const fileManagerState = {
        data_directory_path: path,
        selected_file: fileManager.selectedFile?.file_path || null,
        current_path: fileManager.currentPath,
        selected_channels: fileManager.selectedChannels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden,
      };

      TauriService.updateFileManagerState(fileManagerState).catch((error) =>
        handleError(error, {
          source: "File Manager Persistence",
          severity: "silent",
        }),
      );

      if (persistenceService) {
        persistenceService
          .saveFileManagerState(fileManagerState)
          .catch((error) =>
            handleError(error, {
              source: "File Manager Persistence",
              severity: "silent",
            }),
          );
      }
    }
  },

  setCurrentPath: (path) => {
    set((state) => {
      state.fileManager.currentPath = path;
    });

    if (TauriService.isTauri()) {
      const { fileManager, isPersistenceRestored } = get();
      const persistenceService = getStatePersistenceService();

      if (!isPersistenceRestored) {
        console.log(
          "[STORE] Skipping save during initialization - current path set to:",
          path,
        );
        return;
      }

      const fileManagerState = {
        data_directory_path: fileManager.dataDirectoryPath,
        selected_file: fileManager.selectedFile?.file_path || null,
        current_path: path,
        selected_channels: fileManager.selectedChannels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden,
      };

      TauriService.updateFileManagerState(fileManagerState).catch((error) =>
        handleError(error, {
          source: "File Manager Persistence",
          severity: "silent",
        }),
      );

      if (persistenceService) {
        persistenceService
          .saveFileManagerState(fileManagerState)
          .catch((error) =>
            handleError(error, {
              source: "File Manager Persistence",
              severity: "silent",
            }),
          );
      }
    }
  },

  resetCurrentPathSync: async () => {
    set((state) => {
      state.fileManager.currentPath = [];
    });

    if (TauriService.isTauri()) {
      const { fileManager } = get();
      const persistenceService = getStatePersistenceService();
      const fileManagerState = {
        data_directory_path: fileManager.dataDirectoryPath,
        selected_file: null,
        current_path: [],
        selected_channels: fileManager.selectedChannels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden,
      };

      TauriService.updateFileManagerState(fileManagerState).catch(
        console.error,
      );

      if (persistenceService) {
        await persistenceService.saveFileManagerState(fileManagerState);
        await persistenceService.forceSave();
      }
    }
  },

  setSelectedFile: (file) => {
    console.log(
      "[STORE] setSelectedFile called with:",
      file?.file_path || "null",
    );

    console.log(
      "[STORE] Clearing DDA state, resetting chunk position, and setting file immediately (synchronous)",
    );
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
          console.log(
            "[STORE] Loading file-centric state for:",
            file.file_path,
          );

          const fileStateManager = getInitializedFileStateManager();
          const fileState = await fileStateManager.loadFileState(
            file.file_path,
          );

          console.log("[STORE] Loaded file state:", {
            hasPlot: !!fileState.plot,
            hasDDA: !!fileState.dda,
            hasAnnotations: !!fileState.annotations,
          });

          if (fileState.plot) {
            const plotState = fileState.plot as FilePlotState;
            const chunkStartTime =
              (plotState.chunkStart || 0) / file.sample_rate;
            const isOutOfBounds = chunkStartTime >= file.duration;

            if (isOutOfBounds) {
              console.log(
                `[STORE] Persisted chunkStart (${chunkStartTime.toFixed(2)}s) exceeds file duration (${file.duration.toFixed(2)}s) - resetting to 0`,
              );
            }

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

            console.log("[STORE] File has DDA state:", {
              currentAnalysisId: ddaState.currentAnalysisId,
              historyCount: ddaState.analysisHistory?.length || 0,
            });

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
            console.log(
              "[STORE] No DDA state for this file - clearing results",
            );
            set((state) => {
              state.dda.currentAnalysis = null;
              state.dda.analysisHistory = [];
            });
          }

          console.log(
            "[STORE] Loading annotations for file from both sources:",
            file.file_path,
          );

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

                console.log("[STORE] Loaded from FileStateManager:", {
                  globalCount: fsGlobal.length,
                  channelsCount: Object.keys(fsChannels).length,
                });

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

                console.log("[STORE] Loaded from SQLite database:", {
                  globalCount: sqliteGlobal.length,
                  channelsCount: Object.keys(sqliteChannels).length,
                });

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

              const totalMerged =
                mergedGlobalAnnotations.length +
                Object.values(mergedChannelAnnotations).reduce(
                  (sum, anns) => sum + anns.length,
                  0,
                );

              console.log("[STORE] Merged annotations from both sources:", {
                filePath: file.file_path,
                totalAnnotations: totalMerged,
                globalCount: mergedGlobalAnnotations.length,
                channelsCount: Object.keys(mergedChannelAnnotations).length,
              });

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

              console.log(
                "[STORE] After loading merged annotations, store state:",
                {
                  filePath: file.file_path,
                  globalAnnotations:
                    get().annotations.timeSeries[file.file_path]
                      ?.globalAnnotations?.length || 0,
                },
              );
            } catch (err) {
              console.error(
                "[STORE] Failed to load/merge annotations for file:",
                file.file_path,
                err,
              );

              if (annotationState?.timeSeries) {
                console.log(
                  "[STORE] Fallback: using FileStateManager annotations only for:",
                  file.file_path,
                );

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
          const selectedFilePath = file?.file_path || null;

          console.log(
            "[STORE] After set(), fileManager.selectedFile:",
            updatedFileManager.selectedFile?.file_path || "null",
          );
          console.log("[STORE] isPersistenceRestored:", isPersistenceRestored);

          TauriService.updateFileManagerState({
            selected_file: selectedFilePath,
            current_path: updatedFileManager.currentPath,
            selected_channels: updatedFileManager.selectedChannels,
            search_query: updatedFileManager.searchQuery,
            sort_by: updatedFileManager.sortBy,
            sort_order: updatedFileManager.sortOrder,
            show_hidden: updatedFileManager.showHidden,
          }).catch((error) =>
            handleError(error, {
              source: "File Manager Persistence",
              severity: "silent",
            }),
          );

          if (isPersistenceRestored && file) {
            console.log(
              "[STORE] ✓ Triggering save for selected file:",
              file.file_path,
            );
            get()
              .saveCurrentState()
              .catch((err) =>
                console.error("[STORE] Failed to save selected file:", err),
              );
          } else if (!file && isPersistenceRestored) {
            console.log("[STORE] ✓ Saving cleared file selection");
            get()
              .saveCurrentState()
              .catch((err) =>
                console.error("[STORE] Failed to save cleared file:", err),
              );
          } else {
            console.log(
              "[STORE] ✗ NOT saving - isPersistenceRestored:",
              isPersistenceRestored,
            );
          }
        } catch (err) {
          console.error("[STORE] Failed to load file-centric state:", err);
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
        console.log(
          "[STORE] Skipping save during initialization - selected channels set",
        );
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
            console.error(
              "[STORE] Failed to save file-centric state for channels:",
              err,
            );
          }
        })();
      }

      TauriService.updateFileManagerState({
        selected_file: fileManager.selectedFile?.file_path || null,
        current_path: fileManager.currentPath,
        selected_channels: channels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden,
      }).catch((error) =>
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
      // Use spread for partial updates - more idiomatic with Immer
      state.fileManager = { ...state.fileManager, ...updates };
    });

    if (TauriService.isTauri()) {
      const { fileManager } = get();
      TauriService.updateFileManagerState({
        selected_file: fileManager.selectedFile?.file_path || null,
        current_path: fileManager.currentPath,
        selected_channels: fileManager.selectedChannels,
        search_query: fileManager.searchQuery,
        sort_by: fileManager.sortBy,
        sort_order: fileManager.sortOrder,
        show_hidden: fileManager.showHidden,
      }).catch((error) =>
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

    if (!filePath || !dataDir) {
      console.warn(
        "[STORE] Cannot navigate to file - missing path or data directory",
      );
      return;
    }

    if (!filePath.startsWith(dataDir)) {
      console.warn("[STORE] File is not under data directory:", filePath);
      return;
    }

    const lastSlash = filePath.lastIndexOf("/");
    const fileDir = lastSlash > 0 ? filePath.substring(0, lastSlash) : filePath;

    const relativePath = fileDir.substring(dataDir.length);
    const pathSegments = relativePath.split("/").filter(Boolean);

    console.log("[STORE] Navigating to file:", {
      filePath,
      dataDir,
      fileDir,
      relativePath,
      pathSegments,
    });

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
