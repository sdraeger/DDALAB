/**
 * Utility functions for managing localStorage and preventing quota exceeded errors
 */

interface StorageEntry {
  key: string;
  timestamp: number;
  size: number;
}

/**
 * Clean up old localStorage entries to free up space
 */
export function cleanupOldStorageEntries(maxAgeHours: number = 24): void {
  try {
    const now = Date.now();
    const maxAge = maxAgeHours * 60 * 60 * 1000; // Convert hours to milliseconds

    const entries: StorageEntry[] = [];

    // Collect all localStorage entries with their metadata
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      const value = localStorage.getItem(key);
      if (!value) continue;

      let timestamp = now; // Default to current time if no timestamp found
      let size = new Blob([value]).size;

      // Try to extract timestamp from the value if it's JSON
      try {
        const parsed = JSON.parse(value);
        if (parsed.timestamp && typeof parsed.timestamp === "number") {
          timestamp = parsed.timestamp;
        }
      } catch {
        // Not JSON or no timestamp, use current time
      }

      entries.push({ key, timestamp, size });
    }

    // Find entries older than maxAge
    const oldEntries = entries.filter(
      (entry) => now - entry.timestamp > maxAge
    );

    // Remove old entries, prioritizing the largest ones
    oldEntries
      .sort((a, b) => b.size - a.size) // Sort by size descending
      .forEach((entry) => {
        try {
          localStorage.removeItem(entry.key);
          console.log(
            `Cleaned up old storage entry: ${entry.key} (${Math.round(
              entry.size / 1024
            )}KB)`
          );
        } catch (error) {
          console.warn(
            `Failed to remove old storage entry ${entry.key}:`,
            error
          );
        }
      });

    if (oldEntries.length > 0) {
      const totalCleaned = oldEntries.reduce(
        (sum, entry) => sum + entry.size,
        0
      );
      console.log(
        `Cleaned up ${oldEntries.length} old entries, freed ${Math.round(
          totalCleaned / 1024
        )}KB`
      );
    }
  } catch (error) {
    console.warn("Error during storage cleanup:", error);
  }
}

/**
 * Clean up specific pattern of localStorage entries
 */
export function cleanupStorageByPattern(
  pattern: RegExp,
  maxEntries: number = 10
): void {
  try {
    const matchingEntries: StorageEntry[] = [];

    // Find all entries matching the pattern
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !pattern.test(key)) continue;

      const value = localStorage.getItem(key);
      if (!value) continue;

      let timestamp = Date.now();
      const size = new Blob([value]).size;

      // Try to extract timestamp
      try {
        const parsed = JSON.parse(value);
        if (parsed.timestamp && typeof parsed.timestamp === "number") {
          timestamp = parsed.timestamp;
        }
      } catch {
        // Use current time
      }

      matchingEntries.push({ key, timestamp, size });
    }

    // If we have more than maxEntries, remove the oldest ones
    if (matchingEntries.length > maxEntries) {
      const toRemove = matchingEntries
        .sort((a, b) => a.timestamp - b.timestamp) // Sort by timestamp ascending (oldest first)
        .slice(0, matchingEntries.length - maxEntries);

      toRemove.forEach((entry) => {
        try {
          localStorage.removeItem(entry.key);
          console.log(`Cleaned up excess storage entry: ${entry.key}`);
        } catch (error) {
          console.warn(`Failed to remove storage entry ${entry.key}:`, error);
        }
      });

      if (toRemove.length > 0) {
        const totalCleaned = toRemove.reduce(
          (sum, entry) => sum + entry.size,
          0
        );
        console.log(
          `Cleaned up ${toRemove.length} excess entries, freed ${Math.round(
            totalCleaned / 1024
          )}KB`
        );
      }
    }
  } catch (error) {
    console.warn("Error during pattern-based storage cleanup:", error);
  }
}

/**
 * Check localStorage usage and warn if approaching quota
 */
export function checkStorageUsage(): void {
  try {
    let totalSize = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      const value = localStorage.getItem(key);
      if (!value) continue;

      totalSize += new Blob([value]).size;
    }

    const totalSizeMB = totalSize / (1024 * 1024);
    const warningThreshold = 4; // 4MB warning threshold (localStorage is typically 5-10MB)

    console.log(`localStorage usage: ${Math.round(totalSizeMB * 100) / 100}MB`);

    if (totalSizeMB > warningThreshold) {
      console.warn(
        `localStorage usage (${
          Math.round(totalSizeMB * 100) / 100
        }MB) is approaching quota limits. Consider cleanup.`
      );

      // Auto-cleanup if very close to limit
      if (totalSizeMB > 5) {
        console.log("Auto-cleaning localStorage due to high usage...");
        cleanupOldStorageEntries(12); // Clean entries older than 12 hours
        cleanupStorageByPattern(/^modern-popped-widget-/, 5); // Keep only 5 most recent widget popouts
      }
    }
  } catch (error) {
    console.warn("Error checking storage usage:", error);
  }
}

/**
 * Safe localStorage.setItem with quota handling
 */
export function safeSetItem(
  key: string,
  value: string,
  maxRetries: number = 3
): boolean {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "QuotaExceededError"
      ) {
        console.warn(
          `Storage quota exceeded on attempt ${
            attempt + 1
          }, attempting cleanup...`
        );

        // Try progressive cleanup strategies
        if (attempt === 0) {
          // First attempt: clean old entries
          cleanupOldStorageEntries(6); // Clean entries older than 6 hours
        } else if (attempt === 1) {
          // Second attempt: more aggressive cleanup
          cleanupOldStorageEntries(1); // Clean entries older than 1 hour
          cleanupStorageByPattern(/^modern-popped-widget-/, 3); // Keep only 3 recent widgets
        } else {
          // Final attempt: emergency cleanup
          cleanupOldStorageEntries(0.1); // Clean entries older than 6 minutes
          cleanupStorageByPattern(/^widget-/, 2); // Clean most widget-related entries
        }
      } else {
        console.error("Error setting localStorage item:", error);
        return false;
      }
    }
  }

  console.error(`Failed to store item after ${maxRetries} attempts`);
  return false;
}
