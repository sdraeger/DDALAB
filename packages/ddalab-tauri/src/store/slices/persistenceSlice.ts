/**
 * Persistence and initialization state slice
 */

import { TauriService } from "@/services/tauriService";
import { getStatePersistenceService } from "@/services/statePersistenceService";
import { initializeFileStateSystem } from "@/services/fileStateInitializer";
import type { PersistenceSlice, InitSlice, ImmerStateCreator } from "./types";

// Module-level flags to prevent re-initialization during Hot Module Reload
let isInitializingPersistence = false;
let hasInitializedPersistence = false;

export const createPersistenceSlice: ImmerStateCreator<
  PersistenceSlice & InitSlice
> = (set, get) => ({
  isInitialized: false,
  isPersistenceRestored: false,
  persistenceService: null,

  initializePersistence: async () => {
    if (TauriService.isTauri()) {
      if (hasInitializedPersistence || isInitializingPersistence) {
        console.log(
          "[STORE] Persistence already initialized/initializing (module-level check), skipping",
        );
        return;
      }

      isInitializingPersistence = true;

      try {
        console.log("[STORE] Initializing persistence service...");

        await initializeFileStateSystem();
        console.log("[STORE] File-centric state system initialized");

        const service = getStatePersistenceService({
          autoSave: true,
          saveInterval: 30000,
          includeAnalysisHistory: true,
          includePlotData: true,
          maxHistoryItems: 50,
        });

        const persistedState = await service.initialize();

        let dataDirectoryPath = "";
        try {
          dataDirectoryPath = await TauriService.getDataDirectory();
          console.log(
            "[STORE] Loaded data directory from backend:",
            dataDirectoryPath,
          );
        } catch (error) {
          console.error(
            "[STORE] Failed to load data directory from backend:",
            error,
          );
          dataDirectoryPath =
            persistedState.file_manager.data_directory_path || "";
        }

        service.setCurrentStateGetter(() => {
          const currentState = get();
          return currentState.saveCurrentState();
        });

        set((state) => {
          const selectedFile = null;

          const currentAnalysis =
            state.dda.currentAnalysis ||
            (persistedState.dda.current_analysis
              ? {
                  id: persistedState.dda.current_analysis.id,
                  file_path: persistedState.dda.current_analysis.file_path,
                  created_at: persistedState.dda.current_analysis.created_at,
                  results: persistedState.dda.current_analysis.results,
                  parameters: persistedState.dda.current_analysis.parameters,
                  plot_data: persistedState.dda.current_analysis.plot_data,
                  channels: persistedState.file_manager.selected_channels,
                  status: "completed" as const,
                }
              : null);

          const analysisHistory = persistedState.dda.analysis_history.map(
            (item) => ({
              id: item.id,
              file_path: item.file_path,
              created_at: item.created_at,
              results: item.results,
              parameters: item.parameters,
              plot_data: item.plot_data,
              channels: persistedState.file_manager.selected_channels,
              status: "completed" as const,
            }),
          );

          const restoredAnnotations = {
            timeSeries:
              persistedState.ui?.frontend_state?.annotations?.timeSeries ||
              persistedState.annotations?.timeSeries ||
              {},
            ddaResults:
              persistedState.ui?.frontend_state?.annotations?.ddaResults ||
              persistedState.annotations?.ddaResults ||
              {},
          };

          console.log("[STORE] ===== RESTORING ANNOTATIONS =====");
          const annotationFileKeys = Object.keys(
            restoredAnnotations.timeSeries,
          );
          if (annotationFileKeys.length > 0) {
            annotationFileKeys.forEach((filePath) => {
              const fileAnnotations = restoredAnnotations.timeSeries[filePath];
              console.log("[STORE] Restoring annotations for:", filePath, {
                globalCount: fileAnnotations?.globalAnnotations?.length || 0,
                channelCount: Object.keys(
                  fileAnnotations?.channelAnnotations || {},
                ).length,
              });
            });
          } else {
            console.log("[STORE] No annotations found in persisted state");
          }
          console.log("[STORE] =====================================");

          const pendingFile =
            persistedState.file_manager?.selected_file ||
            (persistedState as any).last_selected_file;
          console.log(
            "[STORE] 📂 Restoring file manager state:",
            "Selected file:",
            persistedState.file_manager?.selected_file || "null",
            "| Will set pending:",
            pendingFile || "NONE",
            "| Selected channels:",
            persistedState.file_manager?.selected_channels?.length || 0,
          );

          state.isPersistenceRestored = true;
          state.persistenceService = service;

          state.fileManager.dataDirectoryPath = dataDirectoryPath;
          state.fileManager.currentPath =
            persistedState.file_manager?.current_path || [];
          state.fileManager.selectedFile = selectedFile;
          state.fileManager.selectedChannels =
            persistedState.file_manager?.selected_channels || [];
          state.fileManager.searchQuery =
            persistedState.file_manager?.search_query || "";
          state.fileManager.sortBy =
            (persistedState.file_manager?.sort_by as
              | "name"
              | "size"
              | "date") || "name";
          state.fileManager.sortOrder =
            (persistedState.file_manager?.sort_order as "asc" | "desc") ||
            "asc";
          state.fileManager.showHidden =
            persistedState.file_manager?.show_hidden || false;
          state.fileManager.pendingFileSelection =
            persistedState.file_manager?.selected_file ||
            (persistedState as any).last_selected_file;

          console.log(
            "[STORE] Restoring plot state (chunkStart reset to 0 - will be restored per-file):",
            {
              persistedChunkStart: persistedState.plot?.filters?.chunkStart,
              persistedChunkSize: persistedState.plot?.filters?.chunkSize,
            },
          );
          state.plot.chunkSize =
            persistedState.plot?.filters?.chunkSize || state.plot.chunkSize;
          state.plot.chunkStart = 0;
          state.plot.amplitude =
            persistedState.plot?.filters?.amplitude || state.plot.amplitude;
          state.plot.showAnnotations = Boolean(
            persistedState.plot?.filters?.showAnnotations ??
              state.plot.showAnnotations,
          );
          state.plot.preprocessing = persistedState.plot?.preprocessing;

          state.dda.analysisParameters.variants =
            persistedState.dda?.selected_variants ||
            state.dda.analysisParameters.variants;
          state.dda.analysisParameters.windowLength =
            persistedState.dda?.parameters?.windowLength ||
            persistedState.dda?.analysis_parameters?.windowLength ||
            state.dda.analysisParameters.windowLength;
          state.dda.analysisParameters.windowStep =
            persistedState.dda?.parameters?.windowStep ||
            persistedState.dda?.analysis_parameters?.windowStep ||
            state.dda.analysisParameters.windowStep;
          state.dda.analysisParameters.scaleMin =
            persistedState.dda?.parameters?.scaleMin ||
            persistedState.dda?.analysis_parameters?.scaleMin ||
            state.dda.analysisParameters.scaleMin;
          state.dda.analysisParameters.scaleMax =
            persistedState.dda?.parameters?.scaleMax ||
            persistedState.dda?.analysis_parameters?.scaleMax ||
            state.dda.analysisParameters.scaleMax;
          state.dda.analysisParameters.scaleNum =
            persistedState.dda?.parameters?.scaleNum ||
            persistedState.dda?.analysis_parameters?.scaleNum ||
            state.dda.analysisParameters.scaleNum;
          state.dda.customDelayPresets =
            persistedState.dda?.custom_delay_presets ||
            state.dda.customDelayPresets;
          state.dda.currentAnalysis = currentAnalysis;
          state.dda.analysisHistory = analysisHistory;

          state.annotations = restoredAnnotations;

          state.ui.activeTab = persistedState.active_tab;
          state.ui.sidebarOpen = !persistedState.sidebar_collapsed;
          state.ui.sidebarWidth = persistedState.ui?.sidebarWidth || 320;
          state.ui.zoom = persistedState.ui?.zoom || 1.0;
          state.ui.expertMode = persistedState.ui?.expertMode ?? false;
          state.ui.panelSizes = [
            persistedState.panel_sizes.sidebar * 100,
            persistedState.panel_sizes.main * 100 -
              persistedState.panel_sizes.sidebar * 100,
            25,
          ];
        });

        hasInitializedPersistence = true;
        console.log("[STORE] Persistence service initialized successfully");
      } catch (error) {
        console.error(
          "[STORE] Failed to initialize persistence:",
          (error as Error)?.message,
        );
        set({ persistenceService: null });
      } finally {
        isInitializingPersistence = false;
      }
    }
  },

  initializeFromTauri: async () => {
    if (TauriService.isTauri()) {
      await get().initializePersistence();
      set({ isInitialized: true });
    } else {
      set({ isInitialized: true });
    }
  },

  saveCurrentState: async () => {
    const service = get().persistenceService;
    const currentState = get();

    if (service) {
      await Promise.resolve();

      console.log("[SAVE] Current state before save:", {
        selectedFile: currentState.fileManager.selectedFile?.file_path || null,
        selectedChannels: currentState.fileManager.selectedChannels,
        chunkSize: currentState.plot.chunkSize,
        chunkStart: currentState.plot.chunkStart,
      });

      const stateToSave = {
        version: "2.0.0",
        file_manager: {
          selected_file:
            currentState.fileManager.selectedFile?.file_path || null,
          current_path: currentState.fileManager.currentPath,
          selected_channels: currentState.fileManager.selectedChannels,
          search_query: currentState.fileManager.searchQuery,
          sort_by: currentState.fileManager.sortBy,
          sort_order: currentState.fileManager.sortOrder,
          show_hidden: currentState.fileManager.showHidden,
        },
        plot: {
          filters: {
            chunkSize: currentState.plot.chunkSize,
            chunkStart: currentState.plot.chunkStart,
            amplitude: currentState.plot.amplitude,
            showAnnotations: currentState.plot.showAnnotations,
          },
          preprocessing: currentState.plot.preprocessing,
        },
        dda: {
          selected_variants: currentState.dda.analysisParameters.variants,
          parameters: currentState.dda.analysisParameters,
          analysis_parameters: currentState.dda.analysisParameters,
          running: false,
        },
        ui: {
          activeTab: currentState.ui.activeTab,
          sidebarOpen: currentState.ui.sidebarOpen,
          sidebarWidth: currentState.ui.sidebarWidth,
          panelSizes: currentState.ui.panelSizes,
          layout: currentState.ui.layout,
          theme: currentState.ui.theme,
          expertMode: currentState.ui.expertMode,
        },
        active_tab: currentState.ui.activeTab,
        sidebar_collapsed: !currentState.ui.sidebarOpen,
        panel_sizes: {
          sidebar: (currentState.ui.panelSizes[0] || 25) / 100,
          main: (currentState.ui.panelSizes[1] || 50) / 100,
          "plot-height": 0.6,
        },
      };

      console.log(
        "[SAVE] Saving lightweight UI state (no annotations, no analysis history)",
      );
      await service.saveCompleteState(stateToSave);
    }
  },

  forceSave: async () => {
    const service = get().persistenceService;
    if (service) {
      await get().saveCurrentState();
      await service.forceSave();
    }
  },

  clearPersistedState: async () => {
    const service = get().persistenceService;
    if (service) {
      await service.clearState();
    }
  },

  getPersistedState: async () => {
    const service = get().persistenceService;
    if (service) {
      return await service.getSavedState();
    }
    return null;
  },

  createStateSnapshot: async () => {
    const service = get().persistenceService;
    if (service) {
      await get().saveCurrentState();
      return await service.createSnapshot();
    }
    return null;
  },
});
