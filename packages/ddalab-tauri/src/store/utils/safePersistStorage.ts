import type { PersistStorage, StorageValue } from "zustand/middleware";
import { createLogger } from "@/lib/logger";

const logger = createLogger("SafePersistStorage");

function hasLocalStorage(): boolean {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

/**
 * Creates a resilient storage adapter for Zustand persist middleware.
 * Corrupted JSON payloads are cleared automatically instead of throwing.
 */
export function createSafePersistStorage<T>(
  storeName: string,
): PersistStorage<T> {
  return {
    getItem: (name) => {
      if (!hasLocalStorage()) {
        return null;
      }

      const raw = window.localStorage.getItem(name);
      if (!raw) {
        return null;
      }

      try {
        return JSON.parse(raw) as StorageValue<T>;
      } catch (error) {
        logger.warn("Clearing corrupted persisted store value", {
          storeName,
          key: name,
          error,
        });
        try {
          window.localStorage.removeItem(name);
        } catch (removeError) {
          logger.warn("Failed to clear corrupted persisted key", {
            storeName,
            key: name,
            error: removeError,
          });
        }
        return null;
      }
    },
    setItem: (name, value) => {
      if (!hasLocalStorage()) {
        return;
      }
      try {
        window.localStorage.setItem(name, JSON.stringify(value));
      } catch (error) {
        logger.warn("Failed to persist store value", {
          storeName,
          key: name,
          error,
        });
      }
    },
    removeItem: (name) => {
      if (!hasLocalStorage()) {
        return;
      }
      try {
        window.localStorage.removeItem(name);
      } catch (error) {
        logger.warn("Failed to remove persisted key", {
          storeName,
          key: name,
          error,
        });
      }
    },
  };
}
