/**
 * File State Initializer
 *
 * Handles initialization of the file-centric state management system.
 * This should be called once during app startup.
 */

import { getFileStateManager } from "./fileStateManager";
import { registerCoreModules } from "./stateModules";
import { createLogger } from "@/lib/logger";
import type { FileStateManager } from "./fileStateManager";

const logger = createLogger("FileStateInit");
const FILE_STATE_INIT_TIMEOUT_MS = 1_000;

let initialized = false;
let initializationPromise: Promise<void> | null = null;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Initialize the file-centric state management system
 */
export async function initializeFileStateSystem(): Promise<void> {
  if (initialized) {
    return;
  }
  if (initializationPromise) {
    await initializationPromise;
    return;
  }

  initializationPromise = (async () => {
    const fileStateManager = getFileStateManager({
      autoSave: true,
      saveInterval: 2000,
      maxCachedFiles: 10,
      persistToBackend: true,
    });

    // Register modules first so the manager is functional even if backend
    // registry hydration is slow or unavailable.
    registerCoreModules(fileStateManager);

    try {
      await withTimeout(
        fileStateManager.initialize(),
        FILE_STATE_INIT_TIMEOUT_MS,
        "Timed out initializing file state system",
      );
    } catch (error) {
      logger.warn("File state backend initialization incomplete", { error });
    }

    initialized = true;
    logger.debug("File-centric state system ready");
  })().finally(() => {
    initializationPromise = null;
  });

  await initializationPromise;
}

/**
 * Ensure the file state manager is fully initialized and ready for use.
 * Callers that perform read/write operations during startup should await this.
 */
export async function ensureFileStateManagerReady(): Promise<FileStateManager> {
  await initializeFileStateSystem();
  return getFileStateManager();
}

/**
 * Get the initialized file state manager
 * Performs best-effort lazy initialization if needed.
 */
export function getInitializedFileStateManager() {
  if (!initialized) {
    logger.debug(
      "FileStateManager requested before init; triggering lazy initialization.",
    );
    void initializeFileStateSystem();
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
