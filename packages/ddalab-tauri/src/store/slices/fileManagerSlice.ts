/**
 * File Manager state slice
 */

import { TauriService } from "@/services/tauriService";
import {
  getInitializedFileStateManager,
  isFileStateSystemInitialized,
} from "@/services/fileStateInitializer";
import { getStatePersistenceService } from "@/services/statePersistenceService";
import { handleError } from "@/utils/errorHandler";
import { createWorkflowAction } from "@/store/middleware/workflowRecordingMiddleware";
import type { FilePlotState, FileDDAState } from "@/types/fileCentricState";
import type {
  FileManagerSlice,
  FileManagerState,
  ImmerStateCreator,
} from "./types";

/** Map file extension to workflow-recordable file type */
function getFileTypeFromPath(
  filePath: string,
):
  | "EDF"
  | "ASCII"
  | "CSV"
  | "BrainVision"
  | "EEGLAB"
  | "FIF"
  | "NIfTI"
  | "XDF" {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "edf":
      return "EDF";
    case "csv":
      return "CSV";
    case "vhdr":
    case "vmrk":
    case "eeg":
      return "BrainVision";
    case "set":
      return "EEGLAB";
    case "fif":
      return "FIF";
    case "nii":
    case "nii.gz":
      return "NIfTI";
    case "xdf":
      return "XDF";
    default:
      return "ASCII";
  }
}

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

    // Record file load action for workflow (silently no-ops if recording disabled)
    if (file) {
      const fileType = getFileTypeFromPath(file.file_path);
      createWorkflowAction.loadFile(file.file_path, fileType);
    }

    if (file && TauriService.isTauri()) {
      // Capture the file path at the start of the async operation
      // This is used to verify the file is still selected before applying state updates
      const targetFilePath = file.file_path;

      // Helper to check if the file is still the selected file
      // Prevents race conditions when user quickly switches between files
      const isFileStillSelected = () => {
        const currentFile = get().fileManager.selectedFile;
        return currentFile?.file_path === targetFilePath;
      };

      (async () => {
        try {
          // Skip file state loading if system isn't initialized yet
          if (!isFileStateSystemInitialized()) {
            return;
          }
          const fileStateManager = getInitializedFileStateManager();

          // Skip loadFileState if ActiveFileContext already loaded it
          if (fileStateManager.isActiveFile(targetFilePath)) {
            const cachedState = fileStateManager.getFileState(targetFilePath);
            if (cachedState) {
              if (!isFileStillSelected()) {
                return;
              }

              // Apply the cached state - batch plot and DDA updates into a single set()
              const cachedPlotState = cachedState.plot as
                | FilePlotState
                | undefined;
              const cachedDdaState = cachedState.dda as
                | FileDDAState
                | undefined;

              set((state) => {
                // Apply plot state from cache
                if (cachedPlotState) {
                  const chunkStartTime =
                    (cachedPlotState.chunkStart || 0) / file.sample_rate;
                  const isOutOfBounds = chunkStartTime >= file.duration;

                  state.plot.chunkStart = isOutOfBounds
                    ? 0
                    : cachedPlotState.chunkStart || 0;
                  state.plot.chunkSize = cachedPlotState.chunkSize || 8192;
                  state.plot.amplitude = cachedPlotState.amplitude || 1.0;
                  state.plot.showAnnotations =
                    cachedPlotState.showAnnotations ?? true;
                  state.plot.preprocessing = cachedPlotState.preprocessing;
                  state.plot.selectedChannelColors =
                    cachedPlotState.channelColors || {};
                  state.fileManager.selectedChannels =
                    cachedPlotState.selectedChannels || [];
                }

                // Apply DDA state from cache
                if (cachedDdaState?.lastParameters) {
                  Object.assign(
                    state.dda.analysisParameters,
                    cachedDdaState.lastParameters,
                  );
                }
                state.dda.currentAnalysis = null;
                state.dda.analysisHistory = [];
              });

              // Load annotations via the annotation slice's single pipeline
              get().loadFileAnnotations(targetFilePath);

              return; // Skip the full loadFileState below
            }
          }

          const fileState = await fileStateManager.loadFileState(
            file.file_path,
          );

          if (!isFileStillSelected()) {
            return;
          }

          // Batch plot and DDA state updates into a single set() call
          const loadedPlotState = fileState.plot as FilePlotState | undefined;
          const loadedDdaState = fileState.dda as FileDDAState | undefined;

          // Guard: Check before applying state
          if (!isFileStillSelected()) return;

          set((state) => {
            // Apply plot state
            if (loadedPlotState) {
              const chunkStartTime =
                (loadedPlotState.chunkStart || 0) / file.sample_rate;
              const isOutOfBounds = chunkStartTime >= file.duration;

              state.plot.chunkStart = isOutOfBounds
                ? 0
                : loadedPlotState.chunkStart || 0;
              state.plot.chunkSize = loadedPlotState.chunkSize || 8192;
              state.plot.amplitude = loadedPlotState.amplitude || 1.0;
              state.plot.showAnnotations =
                loadedPlotState.showAnnotations ?? true;
              state.plot.preprocessing = loadedPlotState.preprocessing;
              state.plot.selectedChannelColors =
                loadedPlotState.channelColors || {};
              state.fileManager.selectedChannels =
                loadedPlotState.selectedChannels || [];
            } else {
              state.plot.chunkStart = 0;
              state.fileManager.selectedChannels = [];
            }

            // Apply DDA state
            if (loadedDdaState?.lastParameters) {
              Object.assign(
                state.dda.analysisParameters,
                loadedDdaState.lastParameters,
              );
            }
            state.dda.currentAnalysis = null;
            state.dda.analysisHistory = [];
          });

          // Load annotations via the annotation slice's single pipeline
          get().loadFileAnnotations(file.file_path);

          // Guard: Check before persisting state
          if (!isFileStillSelected()) return;

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
    const previousChannels = get().fileManager.selectedChannels;
    const filePath = get().fileManager.selectedFile?.file_path;

    set((state) => {
      state.fileManager.selectedChannels = channels;
    });

    // Record channel selection for workflow (silently no-ops if recording disabled)
    if (channels.length > 0) {
      // Convert channel labels to indices if needed, or use indices directly
      const channelIndices = channels.map((ch) => {
        // If channel is a string like "Ch1", parse the number
        const match = ch.match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
      });

      // Determine if this is selecting or deselecting
      if (channels.length > previousChannels.length) {
        createWorkflowAction.selectChannels(channelIndices, filePath);
      } else if (channels.length < previousChannels.length) {
        // Find which channels were deselected
        const deselected = previousChannels.filter(
          (ch) => !channels.includes(ch),
        );
        const deselectedIndices = deselected.map((ch) => {
          const match = ch.match(/\d+/);
          return match ? parseInt(match[0], 10) : 0;
        });
        createWorkflowAction.deselectChannels(deselectedIndices, filePath);
      }
    } else if (previousChannels.length > 0) {
      // All channels cleared
      createWorkflowAction.clearChannelSelection(filePath);
    }

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

  clearSelectedFile: () => {
    const filePath = get().fileManager.selectedFile?.file_path;

    // Record file close action for workflow (silently no-ops if recording disabled)
    if (filePath) {
      createWorkflowAction.closeFile(filePath);
    }

    set((state) => {
      // Clear selected file
      state.fileManager.selectedFile = null;
      state.fileManager.selectedChannels = [];

      // Reset plot state
      state.plot.currentChunk = null;
      state.plot.chunkStart = 0;

      // Reset DDA state
      state.dda.currentAnalysis = null;
      state.dda.previousAnalysis = null;
      state.dda.analysisHistory = [];

      // Reset ICA state
      state.ica.selectedChannels = [];
      state.ica.selectedResultId = null;
    });
  },
});
