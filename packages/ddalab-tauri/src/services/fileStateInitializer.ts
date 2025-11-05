/**
 * File State Initializer
 *
 * Handles initialization of the file-centric state management system.
 * This should be called once during app startup.
 */

import { getFileStateManager } from "./fileStateManager";
import { registerCoreModules } from "./stateModules";

let initialized = false;

/**
 * Initialize the file-centric state management system
 */
export async function initializeFileStateSystem(): Promise<void> {
  if (initialized) {
    console.log("[FileStateInit] System already initialized, skipping");
    return;
  }

  console.log("[FileStateInit] Initializing file-centric state system...");

  try {
    // Get or create the FileStateManager instance
    const fileStateManager = getFileStateManager({
      autoSave: true,
      saveInterval: 2000, // Save every 2 seconds
      maxCachedFiles: 10,
      persistToBackend: true,
    });

    // Initialize the manager (loads registry from backend)
    await fileStateManager.initialize();
    console.log("[FileStateInit] FileStateManager initialized");

    // Register all core state modules
    registerCoreModules(fileStateManager);
    console.log("[FileStateInit] Core modules registered");

    initialized = true;
    console.log("[FileStateInit] File-centric state system ready");
  } catch (error) {
    console.error(
      "[FileStateInit] Failed to initialize file state system:",
      error,
    );
    throw error;
  }
}

/**
 * Get the initialized file state manager
 * Throws if not initialized
 */
export function getInitializedFileStateManager() {
  if (!initialized) {
    throw new Error(
      "FileStateManager not initialized. Call initializeFileStateSystem() first.",
    );
  }
  return getFileStateManager();
}

/**
 * Check if the file state system is initialized
 */
export function isFileStateSystemInitialized(): boolean {
  return initialized;
}

/**
 * Shutdown the file state system (call on app exit)
 */
export async function shutdownFileStateSystem(): Promise<void> {
  if (!initialized) {
    return;
  }

  console.log("[FileStateInit] Shutting down file state system...");

  try {
    const fileStateManager = getFileStateManager();
    await fileStateManager.shutdown();
    initialized = false;
    console.log("[FileStateInit] File state system shut down successfully");
  } catch (error) {
    console.error("[FileStateInit] Error during shutdown:", error);
  }
}
