/**
 * Domain-Specific Store Selectors
 *
 * Provides memoized, typed access to specific store domains.
 * This reduces coupling between components and the monolithic store structure.
 *
 * Benefits:
 * - Components only re-render when their specific slice changes
 * - Centralized selector logic (DRY)
 * - Clear API for accessing store domains
 * - Easy to test and refactor
 */

import { useAppStore } from "./appStore";
import { useShallow } from "zustand/react/shallow";
import type {
  FileManagerState,
  PlotState,
  DDAState,
  HealthState,
  SyncState,
  ICAState,
  UIState,
  AnnotationState,
  WorkflowRecordingState,
  StreamingState,
} from "./slices/types";
import type { PreprocessingState } from "./slices/preprocessingSlice";

// ============================================================================
// File Manager Selectors
// ============================================================================

/**
 * Get file manager state and actions
 */
export function useFileManagerStore() {
  return useAppStore(
    useShallow((state) => ({
      // State
      dataDirectoryPath: state.fileManager.dataDirectoryPath,
      currentPath: state.fileManager.currentPath,
      selectedFile: state.fileManager.selectedFile,
      selectedChannels: state.fileManager.selectedChannels,
      timeWindow: state.fileManager.timeWindow,
      searchQuery: state.fileManager.searchQuery,
      sortBy: state.fileManager.sortBy,
      sortOrder: state.fileManager.sortOrder,
      showHidden: state.fileManager.showHidden,
      pendingFileSelection: state.fileManager.pendingFileSelection,
      highlightedFilePath: state.fileManager.highlightedFilePath,

      // Actions
      setDataDirectoryPath: state.setDataDirectoryPath,
      setCurrentPath: state.setCurrentPath,
      resetCurrentPathSync: state.resetCurrentPathSync,
      setSelectedFile: state.setSelectedFile,
      setSelectedChannels: state.setSelectedChannels,
      setTimeWindow: state.setTimeWindow,
      updateFileManagerState: state.updateFileManagerState,
      clearPendingFileSelection: state.clearPendingFileSelection,
      navigateToFile: state.navigateToFile,
      clearHighlightedFile: state.clearHighlightedFile,
    })),
  );
}

/**
 * Get only selected file (common use case)
 */
export function useSelectedFile() {
  return useAppStore((state) => state.fileManager.selectedFile);
}

/**
 * Get only selected channels
 */
export function useSelectedChannels() {
  const selectedChannels = useAppStore(
    useShallow((state) => state.fileManager.selectedChannels),
  );
  const setSelectedChannels = useAppStore((state) => state.setSelectedChannels);
  return { selectedChannels, setSelectedChannels };
}

// ============================================================================
// Plot Selectors
// ============================================================================

/**
 * Get plot state and actions
 */
export function usePlotStore() {
  return useAppStore(
    useShallow((state) => ({
      // State
      currentChunk: state.plot.currentChunk,
      chunkSize: state.plot.chunkSize,
      chunkStart: state.plot.chunkStart,
      isPlaying: state.plot.isPlaying,
      playbackSpeed: state.plot.playbackSpeed,
      amplitude: state.plot.amplitude,
      showAnnotations: state.plot.showAnnotations,
      selectedChannelColors: state.plot.selectedChannelColors,
      preprocessing: state.plot.preprocessing,
      chartHeight: state.plot.chartHeight,

      // Actions
      setCurrentChunk: state.setCurrentChunk,
      updatePlotState: state.updatePlotState,
      savePlotData: state.savePlotData,
    })),
  );
}

/**
 * Get chart height specifically (for resize)
 */
export function useChartHeight() {
  const chartHeight = useAppStore((state) => state.plot.chartHeight);
  const updatePlotState = useAppStore((state) => state.updatePlotState);
  const setChartHeight = (height: number) =>
    updatePlotState({ chartHeight: height });
  return { chartHeight, setChartHeight };
}

// ============================================================================
// DDA Selectors
// ============================================================================

/**
 * Get DDA analysis state and actions
 */
export function useDDAStore() {
  return useAppStore(
    useShallow((state) => ({
      // State
      currentAnalysis: state.dda.currentAnalysis,
      previousAnalysis: state.dda.previousAnalysis,
      analysisHistory: state.dda.analysisHistory,
      analysisParameters: state.dda.analysisParameters,
      customDelayPresets: state.dda.customDelayPresets,
      isRunning: state.dda.isRunning,
      pendingAnalysisId: state.dda.pendingAnalysisId,

      // Actions
      setCurrentAnalysis: state.setCurrentAnalysis,
      restorePreviousAnalysis: state.restorePreviousAnalysis,
      addAnalysisToHistory: state.addAnalysisToHistory,
      setAnalysisHistory: state.setAnalysisHistory,
      updateAnalysisParameters: state.updateAnalysisParameters,
      setDDARunning: state.setDDARunning,
      saveAnalysisResult: state.saveAnalysisResult,
      addDelayPreset: state.addDelayPreset,
      updateDelayPreset: state.updateDelayPreset,
      deleteDelayPreset: state.deleteDelayPreset,
      setPendingAnalysisId: state.setPendingAnalysisId,
    })),
  );
}

/**
 * Get current analysis only
 */
export function useCurrentAnalysis() {
  return useAppStore((state) => state.dda.currentAnalysis);
}

/**
 * Get DDA running state
 */
export function useDDARunning() {
  const isRunning = useAppStore((state) => state.dda.isRunning);
  const setDDARunning = useAppStore((state) => state.setDDARunning);
  return { isRunning, setDDARunning };
}

// ============================================================================
// UI Selectors
// ============================================================================

/**
 * Get UI state and actions
 */
export function useUIStore() {
  return useAppStore(
    useShallow((state) => ({
      // State
      activeTab: state.ui.activeTab,
      primaryNav: state.ui.primaryNav,
      secondaryNav: state.ui.secondaryNav,
      lastSecondaryNav: state.ui.lastSecondaryNav,
      sidebarOpen: state.ui.sidebarOpen,
      sidebarWidth: state.ui.sidebarWidth,
      panelSizes: state.ui.panelSizes,
      layout: state.ui.layout,
      theme: state.ui.theme,
      isServerReady: state.ui.isServerReady,
      zoom: state.ui.zoom,
      expertMode: state.ui.expertMode,

      // Actions
      setActiveTab: state.setActiveTab,
      setPrimaryNav: state.setPrimaryNav,
      setSecondaryNav: state.setSecondaryNav,
      setSidebarOpen: state.setSidebarOpen,
      setSidebarWidth: state.setSidebarWidth,
      setZoom: state.setZoom,
      increaseZoom: state.increaseZoom,
      decreaseZoom: state.decreaseZoom,
      resetZoom: state.resetZoom,
      setPanelSizes: state.setPanelSizes,
      setLayout: state.setLayout,
      setTheme: state.setTheme,
      setServerReady: state.setServerReady,
      setExpertMode: state.setExpertMode,
    })),
  );
}

/**
 * Get navigation state only
 */
export function useNavigation() {
  return useAppStore(
    useShallow((state) => ({
      primaryNav: state.ui.primaryNav,
      secondaryNav: state.ui.secondaryNav,
      setPrimaryNav: state.setPrimaryNav,
      setSecondaryNav: state.setSecondaryNav,
    })),
  );
}

/**
 * Get sidebar state only
 */
export function useSidebar() {
  return useAppStore(
    useShallow((state) => ({
      sidebarOpen: state.ui.sidebarOpen,
      sidebarWidth: state.ui.sidebarWidth,
      setSidebarOpen: state.setSidebarOpen,
      setSidebarWidth: state.setSidebarWidth,
    })),
  );
}

/**
 * Get theme state
 */
export function useTheme() {
  const theme = useAppStore((state) => state.ui.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  return { theme, setTheme };
}

/**
 * Get zoom state
 */
export function useZoom() {
  return useAppStore(
    useShallow((state) => ({
      zoom: state.ui.zoom,
      setZoom: state.setZoom,
      increaseZoom: state.increaseZoom,
      decreaseZoom: state.decreaseZoom,
      resetZoom: state.resetZoom,
    })),
  );
}

// ============================================================================
// Health Selectors
// ============================================================================

/**
 * Get health/API status
 */
export function useHealthStore() {
  return useAppStore(
    useShallow((state) => ({
      apiStatus: state.health.apiStatus,
      lastCheck: state.health.lastCheck,
      responseTime: state.health.responseTime,
      websocketConnected: state.health.websocketConnected,
      errors: state.health.errors,
      updateHealthStatus: state.updateHealthStatus,
    })),
  );
}

// ============================================================================
// Sync Selectors
// ============================================================================

/**
 * Get sync state
 */
export function useSyncStore() {
  return useAppStore(
    useShallow((state) => ({
      isConnected: state.sync.isConnected,
      isLoading: state.sync.isLoading,
      error: state.sync.error,
      lastStatusCheck: state.sync.lastStatusCheck,
      updateSyncStatus: state.updateSyncStatus,
    })),
  );
}

// ============================================================================
// ICA Selectors
// ============================================================================

/**
 * Get ICA state and actions
 */
export function useICAStore() {
  return useAppStore(
    useShallow((state) => ({
      // State
      selectedChannels: state.ica.selectedChannels,
      nComponents: state.ica.nComponents,
      maxIterations: state.ica.maxIterations,
      tolerance: state.ica.tolerance,
      centering: state.ica.centering,
      whitening: state.ica.whitening,
      showChannelSelector: state.ica.showChannelSelector,
      selectedResultId: state.ica.selectedResultId,
      isSubmitting: state.ica.isSubmitting,

      // Actions
      updateICAState: state.updateICAState,
      resetICAChannels: state.resetICAChannels,
    })),
  );
}

// ============================================================================
// Annotation Selectors
// ============================================================================

/**
 * Get annotation state and actions
 */
export function useAnnotationStore() {
  return useAppStore(
    useShallow((state) => ({
      // State
      timeSeries: state.annotations.timeSeries,
      ddaResults: state.annotations.ddaResults,

      // Actions
      addTimeSeriesAnnotation: state.addTimeSeriesAnnotation,
      updateTimeSeriesAnnotation: state.updateTimeSeriesAnnotation,
      deleteTimeSeriesAnnotation: state.deleteTimeSeriesAnnotation,
      getTimeSeriesAnnotations: state.getTimeSeriesAnnotations,
      loadAllFileAnnotations: state.loadAllFileAnnotations,
      addDDAAnnotation: state.addDDAAnnotation,
      updateDDAAnnotation: state.updateDDAAnnotation,
      deleteDDAAnnotation: state.deleteDDAAnnotation,
      getDDAAnnotations: state.getDDAAnnotations,
    })),
  );
}

// ============================================================================
// Workflow Selectors
// ============================================================================

/**
 * Get workflow recording state
 */
export function useWorkflowStore() {
  return useAppStore(
    useShallow((state) => ({
      isRecording: state.workflowRecording.isRecording,
      currentSessionName: state.workflowRecording.currentSessionName,
      actionCount: state.workflowRecording.actionCount,
      lastActionTimestamp: state.workflowRecording.lastActionTimestamp,
      startWorkflowRecording: state.startWorkflowRecording,
      stopWorkflowRecording: state.stopWorkflowRecording,
      incrementActionCount: state.incrementActionCount,
      getRecordingStatus: state.getRecordingStatus,
    })),
  );
}

// ============================================================================
// Streaming Selectors
// ============================================================================

/**
 * Get streaming state and actions
 */
export function useStreamingStore() {
  return useAppStore(
    useShallow((state) => ({
      // State
      sessions: state.streaming.sessions,
      plotData: state.streaming.plotData,
      ui: state.streaming.ui,

      // Actions
      createStreamSession: state.createStreamSession,
      stopStreamSession: state.stopStreamSession,
      pauseStreamSession: state.pauseStreamSession,
      resumeStreamSession: state.resumeStreamSession,
      updateStreamSession: state.updateStreamSession,
      removeStreamSession: state.removeStreamSession,
      addStreamData: state.addStreamData,
      addStreamResult: state.addStreamResult,
      clearStreamPlotData: state.clearStreamPlotData,
      updateStreamUI: state.updateStreamUI,
      handleStreamEvent: state.handleStreamEvent,
      addToStreamHistory: state.addToStreamHistory,
      createStreamFromHistory: state.createStreamFromHistory,
      removeFromStreamHistory: state.removeFromStreamHistory,
    })),
  );
}

// ============================================================================
// Preprocessing Selectors
// ============================================================================

/**
 * Get preprocessing state and actions
 */
export function usePreprocessingStore() {
  return useAppStore(
    useShallow((state) => ({
      // State
      preprocessing: state.preprocessing,

      // Pipeline lifecycle
      createPipeline: state.createPipeline,
      deletePipeline: state.deletePipeline,
      duplicatePipeline: state.duplicatePipeline,
      setActivePipeline: state.setActivePipeline,
      renamePipeline: state.renamePipeline,
      applyPreset: state.applyPreset,

      // Step enable/disable
      setStepEnabled: state.setStepEnabled,
      setAllStepsEnabled: state.setAllStepsEnabled,

      // Step configuration
      updateBadChannelConfig: state.updateBadChannelConfig,
      updateFilteringConfig: state.updateFilteringConfig,
      updateReferenceConfig: state.updateReferenceConfig,
      updateICAConfig: state.updateICAConfig,
      updateArtifactRemovalConfig: state.updateArtifactRemovalConfig,

      // Step status
      setStepStatus: state.setStepStatus,
      setStepResult: state.setStepResult,

      // Pipeline execution
      setPipelineRunning: state.setPipelineRunning,
      setPipelineProgress: state.setPipelineProgress,
      resetPipelineResults: state.resetPipelineResults,

      // Preview
      setPreviewMode: state.setPreviewMode,
      setPreviewChannel: state.setPreviewChannel,

      // Utilities
      getPipeline: state.getPipeline,
      getPipelineForFile: state.getPipelineForFile,
      getAllPresets: state.getAllPresets,
    })),
  );
}

// ============================================================================
// Persistence Selectors
// ============================================================================

/**
 * Get persistence state
 */
export function usePersistenceStore() {
  return useAppStore(
    useShallow((state) => ({
      isInitialized: state.isInitialized,
      isPersistenceRestored: state.isPersistenceRestored,
      saveCurrentState: state.saveCurrentState,
      forceSave: state.forceSave,
      clearPersistedState: state.clearPersistedState,
      getPersistedState: state.getPersistedState,
      createStateSnapshot: state.createStateSnapshot,
    })),
  );
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Get initialization actions
 */
export function useInitialization() {
  return useAppStore(
    useShallow((state) => ({
      isInitialized: state.isInitialized,
      initializeFromTauri: state.initializeFromTauri,
      initializePersistence: state.initializePersistence,
    })),
  );
}
