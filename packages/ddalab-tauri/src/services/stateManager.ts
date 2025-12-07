/**
 * State Manager Abstraction
 *
 * Provides a clean abstraction layer between services and the Zustand store.
 * This follows the Dependency Inversion Principle (DIP) - high-level modules
 * (services) depend on abstractions rather than concrete implementations.
 *
 * Benefits:
 * - Services can be tested without Zustand
 * - State management implementation can be swapped without changing services
 * - Clear contract for what state operations services need
 */

import type { PrimaryNavTab, SecondaryNavTab } from "@/types/navigation";
import type { EDFFileInfo, DDAResult } from "@/types/api";
import type {
  DataChunk,
  StreamingDDAResult,
  StreamEvent,
  StreamSession,
  StreamStats,
} from "@/types/streaming";
import type { UIState } from "@/store/slices/types";

// ============================================================================
// Navigation State Manager Interface
// ============================================================================

export interface INavigationManager {
  setPrimaryNav(tab: PrimaryNavTab): void;
  setSecondaryNav(tab: SecondaryNavTab | null): void;
  setSidebarOpen(open: boolean): void;
  getTheme(): UIState["theme"];
  setTheme(theme: UIState["theme"]): void;
  getSidebarOpen(): boolean;
}

// ============================================================================
// File Manager State Interface
// ============================================================================

export interface IFileManagerState {
  getSelectedFile(): EDFFileInfo | null;
  getSelectedChannels(): string[];
  setSelectedChannels(channels: string[]): void;
}

// ============================================================================
// DDA State Manager Interface
// ============================================================================

export interface IDDAStateManager {
  getCurrentAnalysis(): DDAResult | null;
  setCurrentAnalysis(analysis: DDAResult | null): void;
  getAnalysisHistory(): DDAResult[];
  getAnalysisParameters(): {
    variants: string[];
    windowLength: number;
    windowStep: number;
    delays: number[];
  };
  getCustomDelayPresets(): Array<{
    id: string;
    name: string;
    description: string;
    delays: number[];
    isBuiltIn: boolean;
  }>;
  setPendingAnalysisId(id: string | null): void;
  setDDARunning(running: boolean): void;
}

// ============================================================================
// Streaming State Manager Interface
// ============================================================================

export interface IStreamingStateManager {
  getSessions(): Record<string, StreamSession>;
  handleStreamEvent(event: StreamEvent): void;
  addStreamData(streamId: string, chunk: DataChunk): void;
  addStreamResult(streamId: string, result: StreamingDDAResult): void;
  updateStreamSession(streamId: string, updates: Partial<StreamSession>): void;
  clearStreamPlotData(streamId: string): void;
}

// ============================================================================
// Annotation State Manager Interface
// ============================================================================

export interface IAnnotationStateManager {
  getTimeSeriesAnnotations(): Record<
    string,
    {
      globalAnnotations?: Array<{
        label?: string;
        position: number;
        description?: string;
      }>;
      channelAnnotations?: Record<
        string,
        Array<{ label?: string; position: number; description?: string }>
      >;
    }
  >;
}

// ============================================================================
// Combined State Manager Interface
// ============================================================================

export interface IStateManager
  extends INavigationManager,
    IFileManagerState,
    IDDAStateManager,
    IStreamingStateManager,
    IAnnotationStateManager {}

// ============================================================================
// State Manager Factory
// ============================================================================

type StateManagerFactory = () => IStateManager;

let stateManagerFactory: StateManagerFactory | null = null;

/**
 * Register the state manager factory.
 * Called once during app initialization to inject the Zustand implementation.
 */
export function registerStateManager(factory: StateManagerFactory): void {
  stateManagerFactory = factory;
}

/**
 * Get the state manager instance.
 * Services should call this to get state operations.
 */
export function getStateManager(): IStateManager {
  if (!stateManagerFactory) {
    throw new Error(
      "State manager not registered. Call registerStateManager() during app initialization.",
    );
  }
  return stateManagerFactory();
}

/**
 * Check if state manager is registered (useful for conditional logic)
 */
export function isStateManagerRegistered(): boolean {
  return stateManagerFactory !== null;
}
