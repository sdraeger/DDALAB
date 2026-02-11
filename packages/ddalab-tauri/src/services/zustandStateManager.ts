/**
 * Zustand State Manager Implementation
 *
 * Concrete implementation of IStateManager using the Zustand store.
 * This bridges the abstraction layer with the actual store.
 */

import type { IStateManager } from "./stateManager";
import { useAppStore } from "@/store/appStore";
import type { PrimaryNavTab, SecondaryNavTab } from "@/types/navigation";
import type { EDFFileInfo, DDAResult } from "@/types/api";
import type {
  DataChunk,
  StreamingDDAResult,
  StreamEvent,
  StreamSession,
} from "@/types/streaming";
import type { UIState } from "@/store/slices/types";

/**
 * Creates a Zustand-backed state manager instance.
 *
 * This function returns an object that implements IStateManager
 * by delegating to useAppStore.getState().
 */
export function createZustandStateManager(): IStateManager {
  const getStore = () => useAppStore.getState();

  return {
    // Navigation
    setPrimaryNav(tab: PrimaryNavTab): void {
      getStore().setPrimaryNav(tab);
    },

    setSecondaryNav(tab: SecondaryNavTab | null): void {
      getStore().setSecondaryNav(tab);
    },

    setSidebarOpen(open: boolean): void {
      getStore().setSidebarOpen(open);
    },

    getTheme(): UIState["theme"] {
      return getStore().ui.theme;
    },

    setTheme(theme: UIState["theme"]): void {
      getStore().setTheme(theme);
    },

    getSidebarOpen(): boolean {
      return getStore().ui.sidebarOpen;
    },

    // File Manager
    getSelectedFile(): EDFFileInfo | null {
      return getStore().fileManager.selectedFile;
    },

    getSelectedChannels(): string[] {
      return getStore().fileManager.selectedChannels;
    },

    setSelectedChannels(channels: string[]): void {
      getStore().setSelectedChannels(channels);
    },

    // DDA
    getCurrentAnalysis(): DDAResult | null {
      return getStore().dda.currentAnalysis;
    },

    setCurrentAnalysis(analysis: DDAResult | null): void {
      getStore().setCurrentAnalysis(analysis);
    },

    getAnalysisHistory(): DDAResult[] {
      return getStore().dda.analysisHistory;
    },

    getAnalysisParameters() {
      return getStore().dda.analysisParameters;
    },

    getCustomDelayPresets() {
      return getStore().dda.customDelayPresets;
    },

    setPendingAnalysisId(id: string | null): void {
      getStore().setPendingAnalysisId(id);
    },

    setDDARunning(running: boolean): void {
      getStore().setDDARunning(running);
    },

    // Streaming
    getSessions(): Record<string, StreamSession> {
      return getStore().streaming.sessions;
    },

    handleStreamEvent(event: StreamEvent): void {
      getStore().handleStreamEvent(event);
    },

    addStreamData(streamId: string, chunk: DataChunk): void {
      getStore().addStreamData(streamId, chunk);
    },

    addStreamResult(streamId: string, result: StreamingDDAResult): void {
      getStore().addStreamResult(streamId, result);
    },

    updateStreamSession(
      streamId: string,
      updates: Partial<StreamSession>,
    ): void {
      getStore().updateStreamSession(streamId, updates);
    },

    clearStreamPlotData(streamId: string): void {
      getStore().clearStreamPlotData(streamId);
    },

    updateBridgeState(state) {
      getStore().updateBridgeState(state);
    },

    // Annotations
    getTimeSeriesAnnotations() {
      return getStore().annotations.timeSeries;
    },
  };
}
