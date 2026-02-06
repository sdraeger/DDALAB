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
    if (this.initialized) return;

    try {
      const savedRegistry = await invoke<FileStateRegistry>(
        "get_file_state_registry",
      );
      this.registry = savedRegistry;
    } catch {
      // No saved registry, starting fresh
    }

    if (this.options.autoSave) {
      this.startAutoSave();
    }

    this.initialized = true;
  }

  /**
   * Check if a file is already the active file
   * Used to prevent duplicate loadFileState calls
   */
  isActiveFile(filePath: string): boolean {
    return this.registry.activeFilePath === filePath;
  }

  /**
   * Get the currently active file path
   */
  getActiveFilePath(): string | null {
    return this.registry.activeFilePath;
  }

  /**
   * Get cached state for a file without loading from modules
   * Returns null if file state doesn't exist in cache
   */
  getFileState(filePath: string): FileSpecificState | null {
    return this.registry.files[filePath] || null;
  }

  /**
   * Register a state module
   * Modules are loaded in priority order (lower priority = loaded first)
   */
  registerModule(module: FileStateModule, priority: number = 100): void {
    if (this.modules.has(module.moduleId)) return;

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

  unregisterModule(moduleId: string): void {
    this.modules.delete(moduleId);
    this.moduleLoadOrder = this.moduleLoadOrder.filter((id) => id !== moduleId);
  }

  async loadFileState(filePath: string): Promise<FileSpecificState> {
    this.registry.lastActiveFilePath = this.registry.activeFilePath;
    this.registry.activeFilePath = filePath;

    let fileState = this.registry.files[filePath];

    if (!fileState) {
      fileState = this.createNewFileState(filePath);
      this.registry.files[filePath] = fileState;
    }

    fileState.metadata.lastAccessed = new Date().toISOString();
    fileState.metadata.accessCount++;

    for (const moduleId of this.moduleLoadOrder) {
      const module = this.modules.get(moduleId);
      if (!module) continue;

      try {
        const moduleState = await module.loadState(filePath);

        if (this.registry.activeFilePath !== filePath) continue;

        if (moduleState) {
          fileState[moduleId] = moduleState;
        } else {
          fileState[moduleId] = module.getDefaultState();
        }
      } catch {
        if (this.registry.activeFilePath === filePath) {
          fileState[moduleId] = module.getDefaultState();
        }
      }
    }

    this.scheduleSave(filePath);
    return fileState;
  }

  async saveFileState(filePath: string): Promise<void> {
    const fileState = this.registry.files[filePath];
    if (!fileState) return;

    const savePromises = this.moduleLoadOrder.map(async (moduleId) => {
      const module = this.modules.get(moduleId);
      if (!module) return;

      const moduleState = fileState[moduleId];
      if (!moduleState) return;

      try {
        await module.saveState(filePath, moduleState);
      } catch {
        // Module save failed
      }
    });

    await Promise.all(savePromises);

    this.registry.metadata.lastUpdated = new Date().toISOString();

    if (this.options.persistToBackend) {
      try {
        await invoke("save_file_state_registry_metadata", {
          activeFilePath: this.registry.activeFilePath,
          lastActiveFilePath: this.registry.lastActiveFilePath,
        });
      } catch {
        // Registry metadata save failed
      }
    }

    this.pendingSaves.delete(filePath);
  }

  async updateModuleState(
    filePath: string,
    moduleId: string,
    state: any,
  ): Promise<void> {
    const fileState = this.registry.files[filePath];
    if (!fileState) return;

    const oldState = fileState[moduleId];
    fileState[moduleId] = state;

    this.emitChangeEvent({
      filePath,
      moduleId,
      oldState,
      newState: state,
      timestamp: new Date().toISOString(),
    });

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

  async clearFileState(filePath: string): Promise<void> {
    const clearPromises = this.moduleLoadOrder.map(async (moduleId) => {
      const module = this.modules.get(moduleId);
      if (!module) return;

      try {
        await module.clearState(filePath);
      } catch {
        // Clear failed
      }
    });

    await Promise.all(clearPromises);
    delete this.registry.files[filePath];

    if (this.options.persistToBackend) {
      await invoke("save_file_state_registry_metadata", {
        activeFilePath: this.registry.activeFilePath,
        lastActiveFilePath: this.registry.lastActiveFilePath,
      });
    }
  }

  clearActiveFile(): void {
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

  async forceSave(): Promise<void> {
    const savePromises = Array.from(this.pendingSaves).map((filePath) =>
      this.saveFileState(filePath),
    );
    await Promise.all(savePromises);
  }

  async shutdown(): Promise<void> {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }

    await this.forceSave();
    this.initialized = false;
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
    if (this.saveTimer) return;

    this.saveTimer = setInterval(() => {
      if (this.pendingSaves.size === 0) return;

      const filesToSave = Array.from(this.pendingSaves);
      filesToSave.forEach((filePath) => {
        this.saveFileState(filePath).catch(() => {});
      });
    }, this.options.saveInterval);
  }

  private emitChangeEvent(event: FileStateChangeEvent): void {
    this.eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Listener error
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
