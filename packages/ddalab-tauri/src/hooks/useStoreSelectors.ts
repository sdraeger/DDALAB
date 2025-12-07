/**
 * Custom Store Selector Hooks
 *
 * Consolidated selector hooks to reduce excessive individual useAppStore calls.
 * Each hook groups related state and actions for a specific domain.
 *
 * Benefits:
 * - Reduces boilerplate in components (1 hook vs 10+ selectors)
 * - Consistent shallow comparison for arrays/objects
 * - Type-safe interfaces for each domain
 * - Easier to maintain and refactor
 */

import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import type { EDFFileInfo } from "@/types/api";
import type {
  FileManagerState,
  PlotState,
  DDAState,
  UIState,
  ICAState,
  WorkflowRecordingState,
} from "@/store/slices/types";

// ============================================================================
// File Manager Selectors
// ============================================================================

export interface FileManagerSelectors {
  // State
  dataDirectoryPath: string;
  currentPath: string[];
  selectedFile: EDFFileInfo | null;
  selectedChannels: string[];
  timeWindow: { start: number; end: number };
  searchQuery: string;
  sortBy: "name" | "size" | "date";
  sortOrder: "asc" | "desc";
  showHidden: boolean;
  pendingFileSelection: string | null;
  highlightedFilePath: string | null;

  // Actions
  setDataDirectoryPath: (path: string) => void;
  setCurrentPath: (path: string[]) => void;
  resetCurrentPathSync: () => Promise<void>;
  setSelectedFile: (file: EDFFileInfo | null) => void;
  setSelectedChannels: (channels: string[]) => void;
  setTimeWindow: (window: { start: number; end: number }) => void;
  updateFileManagerState: (updates: Partial<FileManagerState>) => void;
  clearPendingFileSelection: () => void;
  navigateToFile: (filePath: string) => void;
  clearHighlightedFile: () => void;
}

export function useFileManagerSelectors(): FileManagerSelectors {
  // State selectors with shallow comparison for arrays/objects
  const state = useAppStore(
    useShallow((s) => ({
      dataDirectoryPath: s.fileManager.dataDirectoryPath,
      currentPath: s.fileManager.currentPath,
      selectedFile: s.fileManager.selectedFile,
      selectedChannels: s.fileManager.selectedChannels,
      timeWindow: s.fileManager.timeWindow,
      searchQuery: s.fileManager.searchQuery,
      sortBy: s.fileManager.sortBy,
      sortOrder: s.fileManager.sortOrder,
      showHidden: s.fileManager.showHidden,
      pendingFileSelection: s.fileManager.pendingFileSelection,
      highlightedFilePath: s.fileManager.highlightedFilePath,
    })),
  );

  // Actions (stable references, no shallow needed)
  const actions = useAppStore(
    useShallow((s) => ({
      setDataDirectoryPath: s.setDataDirectoryPath,
      setCurrentPath: s.setCurrentPath,
      resetCurrentPathSync: s.resetCurrentPathSync,
      setSelectedFile: s.setSelectedFile,
      setSelectedChannels: s.setSelectedChannels,
      setTimeWindow: s.setTimeWindow,
      updateFileManagerState: s.updateFileManagerState,
      clearPendingFileSelection: s.clearPendingFileSelection,
      navigateToFile: s.navigateToFile,
      clearHighlightedFile: s.clearHighlightedFile,
    })),
  );

  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}

// ============================================================================
// DDA Selectors
// ============================================================================

export interface DDASelectors {
  // State
  currentAnalysis: DDAState["currentAnalysis"];
  previousAnalysis: DDAState["previousAnalysis"];
  analysisHistory: DDAState["analysisHistory"];
  analysisParameters: DDAState["analysisParameters"];
  customDelayPresets: DDAState["customDelayPresets"];
  isRunning: boolean;
  pendingAnalysisId: string | null;

  // Actions
  setCurrentAnalysis: (analysis: DDAState["currentAnalysis"]) => void;
  restorePreviousAnalysis: () => void;
  addAnalysisToHistory: (
    analysis: NonNullable<DDAState["currentAnalysis"]>,
  ) => void;
  setAnalysisHistory: (analyses: DDAState["analysisHistory"]) => void;
  updateAnalysisParameters: (
    parameters: Partial<DDAState["analysisParameters"]>,
  ) => void;
  setDDARunning: (running: boolean) => void;
  saveAnalysisResult: (
    analysis: NonNullable<DDAState["currentAnalysis"]>,
  ) => Promise<void>;
  addDelayPreset: (
    preset: Omit<DDAState["customDelayPresets"][0], "id" | "isBuiltIn">,
  ) => void;
  updateDelayPreset: (
    id: string,
    updates: Partial<DDAState["customDelayPresets"][0]>,
  ) => void;
  deleteDelayPreset: (id: string) => void;
  setPendingAnalysisId: (id: string | null) => void;
}

export function useDDASelectors(): DDASelectors {
  const state = useAppStore(
    useShallow((s) => ({
      currentAnalysis: s.dda.currentAnalysis,
      previousAnalysis: s.dda.previousAnalysis,
      analysisHistory: s.dda.analysisHistory,
      analysisParameters: s.dda.analysisParameters,
      customDelayPresets: s.dda.customDelayPresets,
      isRunning: s.dda.isRunning,
      pendingAnalysisId: s.dda.pendingAnalysisId,
    })),
  );

  const actions = useAppStore(
    useShallow((s) => ({
      setCurrentAnalysis: s.setCurrentAnalysis,
      restorePreviousAnalysis: s.restorePreviousAnalysis,
      addAnalysisToHistory: s.addAnalysisToHistory,
      setAnalysisHistory: s.setAnalysisHistory,
      updateAnalysisParameters: s.updateAnalysisParameters,
      setDDARunning: s.setDDARunning,
      saveAnalysisResult: s.saveAnalysisResult,
      addDelayPreset: s.addDelayPreset,
      updateDelayPreset: s.updateDelayPreset,
      deleteDelayPreset: s.deleteDelayPreset,
      setPendingAnalysisId: s.setPendingAnalysisId,
    })),
  );

  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}

// ============================================================================
// UI Selectors
// ============================================================================

export interface UISelectors {
  // State
  activeTab: string;
  primaryNav: UIState["primaryNav"];
  secondaryNav: UIState["secondaryNav"];
  lastSecondaryNav: UIState["lastSecondaryNav"];
  sidebarOpen: boolean;
  sidebarWidth: number;
  panelSizes: number[];
  layout: UIState["layout"];
  theme: UIState["theme"];
  isServerReady: boolean;
  zoom: number;
  expertMode: boolean;

  // Actions
  setActiveTab: (tab: string) => void;
  setPrimaryNav: (tab: UIState["primaryNav"]) => void;
  setSecondaryNav: (tab: UIState["secondaryNav"]) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setZoom: (zoom: number) => void;
  increaseZoom: () => void;
  decreaseZoom: () => void;
  resetZoom: () => void;
  setPanelSizes: (sizes: number[]) => void;
  setLayout: (layout: UIState["layout"]) => void;
  setTheme: (theme: UIState["theme"]) => void;
  setServerReady: (ready: boolean) => void;
  setExpertMode: (enabled: boolean) => void;
}

export function useUISelectors(): UISelectors {
  const state = useAppStore(
    useShallow((s) => ({
      activeTab: s.ui.activeTab,
      primaryNav: s.ui.primaryNav,
      secondaryNav: s.ui.secondaryNav,
      lastSecondaryNav: s.ui.lastSecondaryNav,
      sidebarOpen: s.ui.sidebarOpen,
      sidebarWidth: s.ui.sidebarWidth,
      panelSizes: s.ui.panelSizes,
      layout: s.ui.layout,
      theme: s.ui.theme,
      isServerReady: s.ui.isServerReady,
      zoom: s.ui.zoom,
      expertMode: s.ui.expertMode,
    })),
  );

  const actions = useAppStore(
    useShallow((s) => ({
      setActiveTab: s.setActiveTab,
      setPrimaryNav: s.setPrimaryNav,
      setSecondaryNav: s.setSecondaryNav,
      setSidebarOpen: s.setSidebarOpen,
      setSidebarWidth: s.setSidebarWidth,
      setZoom: s.setZoom,
      increaseZoom: s.increaseZoom,
      decreaseZoom: s.decreaseZoom,
      resetZoom: s.resetZoom,
      setPanelSizes: s.setPanelSizes,
      setLayout: s.setLayout,
      setTheme: s.setTheme,
      setServerReady: s.setServerReady,
      setExpertMode: s.setExpertMode,
    })),
  );

  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}

// ============================================================================
// Plot Selectors
// ============================================================================

export interface PlotSelectors {
  // State
  currentChunk: PlotState["currentChunk"];
  chunkSize: number;
  chunkStart: number;
  isPlaying: boolean;
  playbackSpeed: number;
  amplitude: number;
  showAnnotations: boolean;
  selectedChannelColors: Record<string, string>;
  preprocessing: PlotState["preprocessing"];
  chartHeight: number;

  // Actions
  setCurrentChunk: (chunk: PlotState["currentChunk"]) => void;
  updatePlotState: (updates: Partial<PlotState>) => void;
}

export function usePlotSelectors(): PlotSelectors {
  const state = useAppStore(
    useShallow((s) => ({
      currentChunk: s.plot.currentChunk,
      chunkSize: s.plot.chunkSize,
      chunkStart: s.plot.chunkStart,
      isPlaying: s.plot.isPlaying,
      playbackSpeed: s.plot.playbackSpeed,
      amplitude: s.plot.amplitude,
      showAnnotations: s.plot.showAnnotations,
      selectedChannelColors: s.plot.selectedChannelColors,
      preprocessing: s.plot.preprocessing,
      chartHeight: s.plot.chartHeight,
    })),
  );

  const actions = useAppStore(
    useShallow((s) => ({
      setCurrentChunk: s.setCurrentChunk,
      updatePlotState: s.updatePlotState,
    })),
  );

  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}

// ============================================================================
// ICA Selectors
// ============================================================================

export interface ICASelectors {
  // State
  selectedChannels: number[];
  nComponents: number | undefined;
  maxIterations: number;
  tolerance: number;
  centering: boolean;
  whitening: boolean;
  showChannelSelector: boolean;
  selectedResultId: string | null;
  isSubmitting: boolean;

  // Actions
  updateICAState: (updates: Partial<ICAState>) => void;
  resetICAChannels: (channels: number[]) => void;
}

export function useICASelectors(): ICASelectors {
  const state = useAppStore(
    useShallow((s) => ({
      selectedChannels: s.ica.selectedChannels,
      nComponents: s.ica.nComponents,
      maxIterations: s.ica.maxIterations,
      tolerance: s.ica.tolerance,
      centering: s.ica.centering,
      whitening: s.ica.whitening,
      showChannelSelector: s.ica.showChannelSelector,
      selectedResultId: s.ica.selectedResultId,
      isSubmitting: s.ica.isSubmitting,
    })),
  );

  const actions = useAppStore(
    useShallow((s) => ({
      updateICAState: s.updateICAState,
      resetICAChannels: s.resetICAChannels,
    })),
  );

  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}

// ============================================================================
// Workflow Recording Selectors
// ============================================================================

export interface WorkflowSelectors {
  // State
  isRecording: boolean;
  currentSessionName: string | null;
  actionCount: number;
  lastActionTimestamp: number | null;

  // Actions
  startWorkflowRecording: (sessionName?: string) => void;
  stopWorkflowRecording: () => void;
  incrementActionCount: () => void;
  getRecordingStatus: () => WorkflowRecordingState;
}

export function useWorkflowSelectors(): WorkflowSelectors {
  const state = useAppStore(
    useShallow((s) => ({
      isRecording: s.workflowRecording.isRecording,
      currentSessionName: s.workflowRecording.currentSessionName,
      actionCount: s.workflowRecording.actionCount,
      lastActionTimestamp: s.workflowRecording.lastActionTimestamp,
    })),
  );

  const actions = useAppStore(
    useShallow((s) => ({
      startWorkflowRecording: s.startWorkflowRecording,
      stopWorkflowRecording: s.stopWorkflowRecording,
      incrementActionCount: s.incrementActionCount,
      getRecordingStatus: s.getRecordingStatus,
    })),
  );

  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}

// ============================================================================
// Persistence Selectors (minimal - just status flags)
// ============================================================================

export interface PersistenceSelectors {
  isInitialized: boolean;
  isPersistenceRestored: boolean;
}

export function usePersistenceSelectors(): PersistenceSelectors {
  return useAppStore(
    useShallow((s) => ({
      isInitialized: s.isInitialized,
      isPersistenceRestored: s.isPersistenceRestored,
    })),
  );
}
