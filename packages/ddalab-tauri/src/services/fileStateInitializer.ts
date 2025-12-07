/**
 * File State Initializer
 *
 * Handles initialization of the file-centric state management system.
 * This should be called once during app startup.
 */

import { getFileStateManager } from "./fileStateManager";
import { registerCoreModules } from "./stateModules";
import { createLogger } from "@/lib/logger";

const logger = createLogger("FileStateInit");

let initialized = false;

/**
 * Initialize the file-centric state management system
 */
export async function initializeFileStateSystem(): Promise<void> {
  if (initialized) {
    return;
  }

  try {
    const fileStateManager = getFileStateManager({
      autoSave: true,
      saveInterval: 2000,
      maxCachedFiles: 10,
      persistToBackend: true,
    });

    await fileStateManager.initialize();
    registerCoreModules(fileStateManager);
    initialized = true;
    logger.debug("File-centric state system ready");
  } catch (error) {
    logger.error("Failed to initialize file state system", { error });
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

  try {
    const fileStateManager = getFileStateManager();
    await fileStateManager.shutdown();
    initialized = false;
  } catch (error) {
    logger.error("Error during shutdown", { error });
  }
}
