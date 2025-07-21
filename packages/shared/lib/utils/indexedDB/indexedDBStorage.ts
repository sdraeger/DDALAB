import { plotStorage, PlotData } from "./plotStorage";

// Helper function to check if we're in a browser environment
const isBrowser =
  typeof window !== "undefined" && typeof localStorage !== "undefined";

// Custom storage engine for redux-persist that uses IndexedDB for plots
export const indexedDBStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      // Return null during SSR
      if (!isBrowser) {
        return null;
      }

      if (key === "plots") {
        // For plots, get from IndexedDB
        const plots = await plotStorage.getAllPlots();
        return JSON.stringify(plots);
      } else {
        // For other data, use localStorage
        return localStorage.getItem(key);
      }
    } catch (error) {
      console.error("Error getting item from IndexedDB storage:", error);
      return null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    try {
      // Skip during SSR
      if (!isBrowser) {
        return;
      }

      if (key === "plots") {
        // For plots, save to IndexedDB
        const plots = JSON.parse(value);
        for (const [filePath, plotData] of Object.entries(plots)) {
          try {
            await plotStorage.savePlot({
              filePath,
              ...(plotData as any),
            });
          } catch (error) {
            console.warn(
              `Failed to save plot ${filePath} to IndexedDB:`,
              error
            );
            // Continue with other plots even if one fails
          }
        }
      } else {
        // For other data, use localStorage with quota handling
        try {
          localStorage.setItem(key, value);
        } catch (error) {
          if (error instanceof Error && error.name === "QuotaExceededError") {
            console.warn(
              "localStorage quota exceeded, clearing old data and retrying"
            );
            // Clear old data and retry
            try {
              localStorage.clear();
              localStorage.setItem(key, value);
            } catch (retryError) {
              console.error(
                "Failed to save to localStorage even after clearing:",
                retryError
              );
            }
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      console.error("Error setting item in IndexedDB storage:", error);
    }
  },

  removeItem: async (key: string): Promise<void> => {
    try {
      // Skip during SSR
      if (!isBrowser) {
        return;
      }

      if (key === "plots") {
        // For plots, clear IndexedDB
        await plotStorage.clearAll();
      } else {
        // For other data, use localStorage
        localStorage.removeItem(key);
      }
    } catch (error) {
      console.error("Error removing item from IndexedDB storage:", error);
    }
  },
};
