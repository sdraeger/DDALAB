import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";

export interface RecentFile {
  path: string;
  name: string;
  type: string; // File extension (edf, csv, etc.)
  lastAccessed: number; // Unix timestamp
  accessCount: number;
  metadata?: {
    channels?: number;
    duration?: number; // seconds
    sampleRate?: number;
    fileSize?: number; // bytes
  };
}

export interface FavoriteFile {
  path: string;
  name: string;
  type: string;
  addedAt: number;
}

interface RecentFilesState {
  // Recent files (ordered by last access)
  recentFiles: RecentFile[];
  maxRecentFiles: number;

  // Favorites (pinned files)
  favorites: FavoriteFile[];

  // Search history for command palette
  searchHistory: string[];
  maxSearchHistory: number;

  // Actions
  addRecentFile: (
    file: Omit<RecentFile, "lastAccessed" | "accessCount">,
  ) => void;
  removeRecentFile: (path: string) => void;
  clearRecentFiles: () => void;
  getRecentFilesByType: (type: string) => RecentFile[];
  getMostFrequent: (limit?: number) => RecentFile[];

  // Favorites
  addFavorite: (file: Omit<FavoriteFile, "addedAt">) => void;
  removeFavorite: (path: string) => void;
  isFavorite: (path: string) => boolean;
  toggleFavorite: (file: Omit<FavoriteFile, "addedAt">) => void;

  // Search history
  addSearchQuery: (query: string) => void;
  clearSearchHistory: () => void;
  getSearchSuggestions: (partial: string) => string[];
}

// Helper to format file size
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

// Helper to format duration
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

// Helper to get relative time
export function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}

export const useRecentFilesStore = create<RecentFilesState>()(
  persist(
    immer((set, get) => ({
      recentFiles: [],
      maxRecentFiles: 20,
      favorites: [],
      searchHistory: [],
      maxSearchHistory: 50,

      addRecentFile: (file) => {
        set((state) => {
          const existingIndex = state.recentFiles.findIndex(
            (f) => f.path === file.path,
          );

          if (existingIndex >= 0) {
            // Update existing entry
            state.recentFiles[existingIndex].lastAccessed = Date.now();
            state.recentFiles[existingIndex].accessCount += 1;
            if (file.metadata) {
              state.recentFiles[existingIndex].metadata = file.metadata;
            }
            // Move to front
            const [item] = state.recentFiles.splice(existingIndex, 1);
            state.recentFiles.unshift(item);
          } else {
            // Add new entry
            state.recentFiles.unshift({
              ...file,
              lastAccessed: Date.now(),
              accessCount: 1,
            });
            // Trim to max
            if (state.recentFiles.length > state.maxRecentFiles) {
              state.recentFiles = state.recentFiles.slice(
                0,
                state.maxRecentFiles,
              );
            }
          }
        });
      },

      removeRecentFile: (path) => {
        set((state) => {
          state.recentFiles = state.recentFiles.filter((f) => f.path !== path);
        });
      },

      clearRecentFiles: () => {
        set((state) => {
          state.recentFiles = [];
        });
      },

      getRecentFilesByType: (type) => {
        return get().recentFiles.filter(
          (f) => f.type.toLowerCase() === type.toLowerCase(),
        );
      },

      getMostFrequent: (limit = 5) => {
        return [...get().recentFiles]
          .sort((a, b) => b.accessCount - a.accessCount)
          .slice(0, limit);
      },

      // Favorites
      addFavorite: (file) => {
        set((state) => {
          if (!state.favorites.find((f) => f.path === file.path)) {
            state.favorites.push({
              ...file,
              addedAt: Date.now(),
            });
          }
        });
      },

      removeFavorite: (path) => {
        set((state) => {
          state.favorites = state.favorites.filter((f) => f.path !== path);
        });
      },

      isFavorite: (path) => {
        return get().favorites.some((f) => f.path === path);
      },

      toggleFavorite: (file) => {
        const { isFavorite, addFavorite, removeFavorite } = get();
        if (isFavorite(file.path)) {
          removeFavorite(file.path);
        } else {
          addFavorite(file);
        }
      },

      // Search history
      addSearchQuery: (query) => {
        if (!query.trim()) return;

        set((state) => {
          // Remove if exists
          state.searchHistory = state.searchHistory.filter(
            (q) => q.toLowerCase() !== query.toLowerCase(),
          );
          // Add to front
          state.searchHistory.unshift(query);
          // Trim to max
          if (state.searchHistory.length > state.maxSearchHistory) {
            state.searchHistory = state.searchHistory.slice(
              0,
              state.maxSearchHistory,
            );
          }
        });
      },

      clearSearchHistory: () => {
        set((state) => {
          state.searchHistory = [];
        });
      },

      getSearchSuggestions: (partial) => {
        if (!partial.trim()) return get().searchHistory.slice(0, 5);

        const lower = partial.toLowerCase();
        return get()
          .searchHistory.filter((q) => q.toLowerCase().includes(lower))
          .slice(0, 5);
      },
    })),
    {
      name: "ddalab-recent-files",
    },
  ),
);
