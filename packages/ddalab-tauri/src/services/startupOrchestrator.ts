import { TauriService } from "@/services/tauriService";
import { createLogger } from "@/lib/logger";

const logger = createLogger("StartupOrchestrator");

const PERSISTENCE_INIT_TIMEOUT_MS = 2_500;
const APP_PREFERENCES_TIMEOUT_MS = 1_500;
const DATA_DIRECTORY_TIMEOUT_MS = 1_500;

const inFlightTasks = new Map<string, Promise<unknown>>();
const cachedResults = new Map<string, unknown>();

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Dedupe only concurrent executions.
 * Subsequent calls after completion run the task again.
 */
function runSharedTask<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = inFlightTasks.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = task().finally(() => {
    inFlightTasks.delete(key);
  });

  inFlightTasks.set(key, promise as Promise<unknown>);
  return promise;
}

/**
 * Cache successful results permanently for the app session.
 */
function runCachedTask<T>(key: string, task: () => Promise<T>): Promise<T> {
  if (cachedResults.has(key)) {
    return Promise.resolve(cachedResults.get(key) as T);
  }

  return runSharedTask<T>(key, task).then((result) => {
    cachedResults.set(key, result);
    return result;
  });
}

/**
 * Initialize app persistence for the current store instance.
 * Dedupe concurrent calls to avoid StrictMode/HMR startup races.
 */
export async function initializePersistenceForStore(
  initializeFromTauri: () => Promise<void>,
): Promise<void> {
  await runSharedTask("persistence:init", async () => {
    await withTimeout(
      initializeFromTauri(),
      PERSISTENCE_INIT_TIMEOUT_MS,
      `Persistence initialization timed out after ${PERSISTENCE_INIT_TIMEOUT_MS}ms`,
    );
  });
}

/**
 * Best-effort preferences warmup. Never blocks startup.
 */
export async function loadAppPreferencesOnce(): Promise<void> {
  if (!TauriService.isTauri()) {
    // Tauri bridge may not be ready on the first client tick.
    // Do not cache this non-Tauri result so later calls can retry.
    return;
  }

  await runCachedTask("preferences:load", async () => {
    try {
      await withTimeout(
        TauriService.getAppPreferences(),
        APP_PREFERENCES_TIMEOUT_MS,
        `Preferences load timed out after ${APP_PREFERENCES_TIMEOUT_MS}ms`,
      );
    } catch (error) {
      logger.warn("Preferences warmup failed", { error });
    }
  });
}

/**
 * Resolve data directory once and cache it for this app session.
 * Returns null when unavailable.
 */
export async function resolveDataDirectoryOnce(): Promise<string | null> {
  if (!TauriService.isTauri()) {
    // Tauri bridge may still be initializing; allow caller to retry later.
    return null;
  }

  const key = "directory:data";
  if (cachedResults.has(key)) {
    return (cachedResults.get(key) as string) || null;
  }

  return runSharedTask<string | null>(key, async () => {
    try {
      const path = await withTimeout(
        TauriService.getDataDirectory(),
        DATA_DIRECTORY_TIMEOUT_MS,
        `Data directory lookup timed out after ${DATA_DIRECTORY_TIMEOUT_MS}ms`,
      );
      const normalizedPath = path || null;
      // Only cache successful non-empty paths. A transient failure should be retried.
      if (normalizedPath) {
        cachedResults.set(key, normalizedPath);
      }
      return normalizedPath;
    } catch (error) {
      logger.warn("Failed to resolve data directory", { error });
      return null;
    }
  });
}
