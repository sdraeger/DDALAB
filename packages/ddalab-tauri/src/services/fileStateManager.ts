/**
 * File State Manager Service
 *
 * Centralized service for managing all file-specific state.
 * Implements a modular plugin architecture where different features
 * (plot, DDA, annotations, etc.) can register their state modules.
 *
 * When a file is selected, all registered modules automatically load
 * their state for that file. This ensures a cohesive, file-based workflow.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  FileSpecificState,
  FileStateRegistry,
  FileStateModule,
  ModuleDescriptor,
  FileStateManagerOptions,
  FileStateChangeEvent,
} from "@/types/fileCentricState";

/**
 * Singleton service for managing file-centric state
 */
export class FileStateManager {
  private static instance: FileStateManager | null = null;

  private registry: FileStateRegistry = {
    files: {},
    activeFilePath: null,
    lastActiveFilePath: null,
    metadata: {
      version: "1.0.0",
      lastUpdated: new Date().toISOString(),
    },
  };

  private modules: Map<string, FileStateModule> = new Map();
  private moduleLoadOrder: string[] = [];
  private saveTimer: NodeJS.Timeout | null = null;
  private pendingSaves: Set<string> = new Set();

  private options: FileStateManagerOptions = {
    autoSave: true,
    saveInterval: 2000, // Save every 2 seconds
    maxCachedFiles: 10,
    persistToBackend: true,
  };

  private initialized: boolean = false;
  private eventListeners: ((event: FileStateChangeEvent) => void)[] = [];

  private constructor(options?: Partial<FileStateManagerOptions>) {
    if (options) {
      this.options = { ...this.options, ...options };
    }
  }

  /**
   * Get singleton instance
   */
  static getInstance(
    options?: Partial<FileStateManagerOptions>,
  ): FileStateManager {
    if (!FileStateManager.instance) {
      FileStateManager.instance = new FileStateManager(options);
    }
    return FileStateManager.instance;
  }

  /**
   * Initialize the file state manager
   * Loads the registry from backend
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log("[FileStateManager] Already initialized");
      return;
    }

    console.log("[FileStateManager] Initializing...");

    try {
      // Load registry from backend
      const savedRegistry = await invoke<FileStateRegistry>(
        "get_file_state_registry",
      );
      this.registry = savedRegistry;
      console.log(
        "[FileStateManager] Loaded registry with",
        Object.keys(savedRegistry.files).length,
        "files",
      );
    } catch (error) {
      console.warn(
        "[FileStateManager] No saved registry found, starting fresh:",
        error,
      );
    }

    // Start auto-save if enabled
    if (this.options.autoSave) {
      this.startAutoSave();
    }

    this.initialized = true;
    console.log("[FileStateManager] Initialized successfully");
  }

  /**
   * Register a state module
   * Modules are loaded in priority order (lower priority = loaded first)
   */
  registerModule(module: FileStateModule, priority: number = 100): void {
    if (this.modules.has(module.moduleId)) {
      console.warn(
        "[FileStateManager] Module already registered:",
        module.moduleId,
      );
      return;
    }

    console.log(
      "[FileStateManager] Registering module:",
      module.moduleId,
      "with priority",
      priority,
    );
    this.modules.set(module.moduleId, module);

    // Insert in priority order
    const index = this.moduleLoadOrder.findIndex((id) => {
      const existing = this.modules.get(id);
      return priority < (existing as any).priority || 100;
    });

    if (index === -1) {
      this.moduleLoadOrder.push(module.moduleId);
    } else {
      this.moduleLoadOrder.splice(index, 0, module.moduleId);
    }
  }

  /**
   * Unregister a state module
   */
  unregisterModule(moduleId: string): void {
    this.modules.delete(moduleId);
    this.moduleLoadOrder = this.moduleLoadOrder.filter((id) => id !== moduleId);
    console.log("[FileStateManager] Unregistered module:", moduleId);
  }

  /**
   * Load all state for a file
   * This is called when a file is selected
   */
  async loadFileState(filePath: string): Promise<FileSpecificState> {
    console.log("[FileStateManager] Loading state for file:", filePath);

    // Check if we have cached state
    let fileState = this.registry.files[filePath];

    if (!fileState) {
      // Create new file state
      fileState = this.createNewFileState(filePath);
      this.registry.files[filePath] = fileState;
    }

    // Update access metadata
    fileState.metadata.lastAccessed = new Date().toISOString();
    fileState.metadata.accessCount++;

    // Load state from all registered modules
    for (const moduleId of this.moduleLoadOrder) {
      const module = this.modules.get(moduleId);
      if (!module) continue;

      try {
        console.log(
          "[FileStateManager] Loading module state:",
          moduleId,
          "for file:",
          filePath,
        );
        const moduleState = await module.loadState(filePath);

        if (moduleState) {
          fileState[moduleId] = moduleState;
        } else {
          // Use default state if no saved state exists
          fileState[moduleId] = module.getDefaultState();
        }
      } catch (error) {
        console.error(
          "[FileStateManager] Failed to load module state:",
          moduleId,
          error,
        );
        // Use default state on error
        fileState[moduleId] = module.getDefaultState();
      }
    }

    // Update active file
    this.registry.lastActiveFilePath = this.registry.activeFilePath;
    this.registry.activeFilePath = filePath;

    // Save registry (debounced)
    this.scheduleSave(filePath);

    return fileState;
  }

  /**
   * Save all state for a file
   */
  async saveFileState(filePath: string): Promise<void> {
    const fileState = this.registry.files[filePath];
    if (!fileState) {
      console.warn("[FileStateManager] No state to save for file:", filePath);
      return;
    }

    console.log("[FileStateManager] Saving state for file:", filePath);

    // Save state for all registered modules
    const savePromises = this.moduleLoadOrder.map(async (moduleId) => {
      const module = this.modules.get(moduleId);
      if (!module) return;

      const moduleState = fileState[moduleId];
      if (!moduleState) return;

      try {
        await module.saveState(filePath, moduleState);
        console.log("[FileStateManager] Saved module state:", moduleId);
      } catch (error) {
        console.error(
          "[FileStateManager] Failed to save module state:",
          moduleId,
          error,
        );
      }
    });

    await Promise.all(savePromises);

    // Update registry metadata
    this.registry.metadata.lastUpdated = new Date().toISOString();

    // Save registry to backend
    if (this.options.persistToBackend) {
      try {
        await invoke("save_file_state_registry", { registry: this.registry });
        console.log("[FileStateManager] Registry saved to backend");
      } catch (error) {
        console.error(
          "[FileStateManager] Failed to save registry to backend:",
          error,
        );
      }
    }

    this.pendingSaves.delete(filePath);
  }

  /**
   * Update state for a specific module and file
   */
  async updateModuleState(
    filePath: string,
    moduleId: string,
    state: any,
  ): Promise<void> {
    const fileState = this.registry.files[filePath];
    if (!fileState) {
      console.warn("[FileStateManager] File state not loaded:", filePath);
      return;
    }

    const oldState = fileState[moduleId];
    fileState[moduleId] = state;

    // Emit change event
    this.emitChangeEvent({
      filePath,
      moduleId,
      oldState,
      newState: state,
      timestamp: new Date().toISOString(),
    });

    // Schedule save
    this.scheduleSave(filePath);
  }

  /**
   * Get state for a specific module and file
   */
  getModuleState<T = unknown>(filePath: string, moduleId: string): T | null {
    const fileState = this.registry.files[filePath];
    if (!fileState) {
      return null;
    }

    return (fileState[moduleId] as T) || null;
  }

  /**
   * Get the currently active file's state
   */
  getActiveFileState(): FileSpecificState | null {
    if (!this.registry.activeFilePath) {
      return null;
    }

    return this.registry.files[this.registry.activeFilePath] || null;
  }

  /**
   * Clear all state for a file
   */
  async clearFileState(filePath: string): Promise<void> {
    console.log("[FileStateManager] Clearing state for file:", filePath);

    // Clear state in all modules
    const clearPromises = this.moduleLoadOrder.map(async (moduleId) => {
      const module = this.modules.get(moduleId);
      if (!module) return;

      try {
        await module.clearState(filePath);
      } catch (error) {
        console.error(
          "[FileStateManager] Failed to clear module state:",
          moduleId,
          error,
        );
      }
    });

    await Promise.all(clearPromises);

    // Remove from registry
    delete this.registry.files[filePath];

    // Save registry
    if (this.options.persistToBackend) {
      await invoke("save_file_state_registry", { registry: this.registry });
    }
  }

  /**
   * Clear the active file path (called when all tabs are closed)
   * This does not delete file state, just clears the active file tracking
   */
  clearActiveFile(): void {
    console.log("[FileStateManager] Clearing active file");
    this.registry.lastActiveFilePath = this.registry.activeFilePath;
    this.registry.activeFilePath = null;
  }

  /**
   * Get all file paths that have state
   */
  getTrackedFiles(): string[] {
    return Object.keys(this.registry.files);
  }

  /**
   * Subscribe to state change events
   */
  onStateChange(listener: (event: FileStateChangeEvent) => void): () => void {
    this.eventListeners.push(listener);

    // Return unsubscribe function
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Force save all pending states
   */
  async forceSave(): Promise<void> {
    console.log("[FileStateManager] Force saving all pending states");

    const savePromises = Array.from(this.pendingSaves).map((filePath) =>
      this.saveFileState(filePath),
    );

    await Promise.all(savePromises);
  }

  /**
   * Shutdown the file state manager
   */
  async shutdown(): Promise<void> {
    console.log("[FileStateManager] Shutting down...");

    // Stop auto-save
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }

    // Force save all pending states
    await this.forceSave();

    this.initialized = false;
    console.log("[FileStateManager] Shutdown complete");
  }

  // Private methods

  private createNewFileState(filePath: string): FileSpecificState {
    return {
      filePath,
      metadata: {
        firstOpened: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
        accessCount: 0,
        version: "1.0.0",
      },
    };
  }

  private scheduleSave(filePath: string): void {
    this.pendingSaves.add(filePath);
  }

  private startAutoSave(): void {
    if (this.saveTimer) {
      return;
    }

    this.saveTimer = setInterval(() => {
      if (this.pendingSaves.size === 0) {
        return;
      }

      // Save all pending files
      const filesToSave = Array.from(this.pendingSaves);
      filesToSave.forEach((filePath) => {
        this.saveFileState(filePath).catch((error) => {
          console.error(
            "[FileStateManager] Auto-save failed for file:",
            filePath,
            error,
          );
        });
      });
    }, this.options.saveInterval);
  }

  private emitChangeEvent(event: FileStateChangeEvent): void {
    this.eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error("[FileStateManager] Error in change listener:", error);
      }
    });
  }
}

/**
 * Convenience function to get the file state manager instance
 */
export function getFileStateManager(
  options?: Partial<FileStateManagerOptions>,
): FileStateManager {
  return FileStateManager.getInstance(options);
}
