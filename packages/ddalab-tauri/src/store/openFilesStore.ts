/**
 * Open Files Store
 *
 * Manages the list of currently open files and tracks which file is active.
 * Integrates with FileStateManager for file-centric state loading.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";
import { getFileStateManager } from "@/services/fileStateManager";
import { createLogger } from "@/lib/logger";

const logger = createLogger("OpenFilesStore");

/**
 * Represents an open file in the tab bar
 */
export interface OpenFile {
  /** Full path to the file */
  filePath: string;
  /** Display name (filename without path) */
  fileName: string;
  /** Whether the file has unsaved changes */
  isModified: boolean;
  /** Whether the file is pinned (exempt from LRU eviction) */
  isPinned: boolean;
  /** Timestamp when the file was opened */
  openedAt: string;
  /** Timestamp when the file was last made active */
  lastActiveAt: string;
}

interface OpenFilesState {
  /** List of open files in tab order */
  files: OpenFile[];
  /** Currently active file path */
  activeFilePath: string | null;
  /** Maximum number of open files before LRU eviction */
  maxOpenFiles: number;
  /** Whether the store is currently loading a file */
  isLoading: boolean;
}

interface OpenFilesActions {
  /** Open a file (adds to list if not already open, makes active) */
  openFile: (filePath: string) => Promise<void>;
  /** Close a file (removes from list, switches to another if active) */
  closeFile: (filePath: string) => Promise<void>;
  /** Set a file as active without opening */
  setActiveFile: (filePath: string) => void;
  /** Pin a file to prevent LRU eviction */
  pinFile: (filePath: string) => void;
  /** Unpin a file */
  unpinFile: (filePath: string) => void;
  /** Toggle pin state */
  togglePinFile: (filePath: string) => void;
  /** Mark a file as modified */
  setFileModified: (filePath: string, isModified: boolean) => void;
  /** Reorder files in the tab bar */
  reorderFiles: (fromIndex: number, toIndex: number) => void;
  /** Close all files except the specified one */
  closeOtherFiles: (exceptFilePath: string) => Promise<void>;
  /** Close all files to the right of the specified one */
  closeFilesToRight: (filePath: string) => Promise<void>;
  /** Close all open files */
  closeAllFiles: () => Promise<void>;
  /** Get next file to activate when closing current */
  getNextActiveFile: (closingFilePath: string) => string | null;
}

type OpenFilesStore = OpenFilesState & OpenFilesActions;

/**
 * Extract filename from full path
 */
function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

export const useOpenFilesStore = create<OpenFilesStore>()(
  persist(
    immer((set, get) => ({
      files: [],
      activeFilePath: null,
      maxOpenFiles: 10,
      isLoading: false,

      openFile: async (filePath: string) => {
        const { files, maxOpenFiles } = get();

        // Check if already open
        const existingIndex = files.findIndex((f) => f.filePath === filePath);

        if (existingIndex >= 0) {
          // Already open, just make active
          set((state) => {
            state.activeFilePath = filePath;
            state.files[existingIndex].lastActiveAt = new Date().toISOString();
          });
          return;
        }

        // Set loading state
        set((state) => {
          state.isLoading = true;
        });

        try {
          // Load file state via FileStateManager
          const fileStateManager = getFileStateManager();
          await fileStateManager.loadFileState(filePath);

          set((state) => {
            // Check if we need to evict old files
            if (state.files.length >= maxOpenFiles) {
              // Find oldest non-pinned file
              const unpinnedFiles = state.files
                .map((f, i) => ({ ...f, index: i }))
                .filter((f) => !f.isPinned)
                .sort(
                  (a, b) =>
                    new Date(a.lastActiveAt).getTime() -
                    new Date(b.lastActiveAt).getTime(),
                );

              if (unpinnedFiles.length > 0) {
                // Remove oldest unpinned file
                state.files.splice(unpinnedFiles[0].index, 1);
                logger.debug("LRU evicted file", {
                  evicted: unpinnedFiles[0].filePath,
                });
              }
            }

            // Add new file
            const newFile: OpenFile = {
              filePath,
              fileName: getFileName(filePath),
              isModified: false,
              isPinned: false,
              openedAt: new Date().toISOString(),
              lastActiveAt: new Date().toISOString(),
            };

            state.files.push(newFile);
            state.activeFilePath = filePath;
            state.isLoading = false;
          });

          logger.debug("Opened file", { filePath });
        } catch (error) {
          set((state) => {
            state.isLoading = false;
          });
          logger.error("Failed to open file", { filePath, error });
          throw error;
        }
      },

      closeFile: async (filePath: string) => {
        const { files, activeFilePath, getNextActiveFile } = get();

        const fileIndex = files.findIndex((f) => f.filePath === filePath);
        if (fileIndex === -1) return;

        // Determine next active file before removing
        let nextActive: string | null = null;
        if (activeFilePath === filePath) {
          nextActive = getNextActiveFile(filePath);
        }

        // Save state before closing
        try {
          const fileStateManager = getFileStateManager();
          await fileStateManager.saveFileState(filePath);
        } catch (error) {
          logger.error("Failed to save state before closing", {
            filePath,
            error,
          });
        }

        set((state) => {
          state.files.splice(fileIndex, 1);

          if (state.activeFilePath === filePath) {
            state.activeFilePath = nextActive;
          }
        });

        logger.debug("Closed file", { filePath, nextActive });
      },

      setActiveFile: (filePath: string) => {
        const { files } = get();
        const fileIndex = files.findIndex((f) => f.filePath === filePath);

        if (fileIndex === -1) {
          logger.warn("Attempted to activate non-open file", { filePath });
          return;
        }

        set((state) => {
          state.activeFilePath = filePath;
          state.files[fileIndex].lastActiveAt = new Date().toISOString();
        });
      },

      pinFile: (filePath: string) => {
        const { files } = get();
        const fileIndex = files.findIndex((f) => f.filePath === filePath);
        if (fileIndex === -1) return;

        set((state) => {
          // Count currently pinned tabs (before marking this one as pinned)
          const pinnedCount = state.files.filter((f) => f.isPinned).length;

          // Mark as pinned
          state.files[fileIndex].isPinned = true;

          // Move to end of pinned tabs section (position = pinnedCount)
          if (fileIndex !== pinnedCount) {
            const [file] = state.files.splice(fileIndex, 1);
            state.files.splice(pinnedCount, 0, file);
          }
        });
      },

      unpinFile: (filePath: string) => {
        const { files } = get();
        const fileIndex = files.findIndex((f) => f.filePath === filePath);
        if (fileIndex === -1) return;

        set((state) => {
          state.files[fileIndex].isPinned = false;

          // Count pinned tabs (excluding current file which is being unpinned)
          const pinnedCount = state.files.filter(
            (f, idx) => f.isPinned && idx !== fileIndex,
          ).length;

          // Move to right after the pinned section
          if (fileIndex !== pinnedCount) {
            const [file] = state.files.splice(fileIndex, 1);
            state.files.splice(pinnedCount, 0, file);
          }
        });
      },

      togglePinFile: (filePath: string) => {
        const { files } = get();
        const file = files.find((f) => f.filePath === filePath);
        if (!file) return;

        if (file.isPinned) {
          get().unpinFile(filePath);
        } else {
          get().pinFile(filePath);
        }
      },

      setFileModified: (filePath: string, isModified: boolean) => {
        const { files } = get();
        const fileIndex = files.findIndex((f) => f.filePath === filePath);
        if (fileIndex === -1) return;

        set((state) => {
          state.files[fileIndex].isModified = isModified;
        });
      },

      reorderFiles: (fromIndex: number, toIndex: number) => {
        set((state) => {
          const file = state.files[fromIndex];
          if (!file) return;

          // Count pinned tabs
          const pinnedCount = state.files.filter((f) => f.isPinned).length;

          // Constrain movement to respect pinned/unpinned boundary
          let constrainedTo = toIndex;
          if (file.isPinned) {
            // Pinned tabs can only move within pinned section (0 to pinnedCount-1)
            constrainedTo = Math.min(Math.max(0, toIndex), pinnedCount - 1);
          } else {
            // Unpinned tabs can only move within unpinned section (pinnedCount to end)
            constrainedTo = Math.max(pinnedCount, toIndex);
          }

          if (fromIndex === constrainedTo) return;

          const [removed] = state.files.splice(fromIndex, 1);
          state.files.splice(constrainedTo, 0, removed);
        });
      },

      closeOtherFiles: async (exceptFilePath: string) => {
        const { files, closeFile } = get();

        const filesToClose = files
          .filter((f) => f.filePath !== exceptFilePath)
          .map((f) => f.filePath);

        for (const filePath of filesToClose) {
          await closeFile(filePath);
        }
      },

      closeFilesToRight: async (filePath: string) => {
        const { files, closeFile } = get();

        const fileIndex = files.findIndex((f) => f.filePath === filePath);
        if (fileIndex === -1) return;

        const filesToClose = files.slice(fileIndex + 1).map((f) => f.filePath);

        for (const path of filesToClose) {
          await closeFile(path);
        }
      },

      closeAllFiles: async () => {
        const { files, closeFile } = get();

        // Close in reverse order to avoid index shifting issues
        const filePaths = files.map((f) => f.filePath).reverse();

        for (const filePath of filePaths) {
          await closeFile(filePath);
        }
      },

      getNextActiveFile: (closingFilePath: string): string | null => {
        const { files } = get();

        if (files.length <= 1) return null;

        const closingIndex = files.findIndex(
          (f) => f.filePath === closingFilePath,
        );
        if (closingIndex === -1) return null;

        // Prefer the file to the right, then to the left
        if (closingIndex < files.length - 1) {
          return files[closingIndex + 1].filePath;
        } else if (closingIndex > 0) {
          return files[closingIndex - 1].filePath;
        }

        return null;
      },
    })),
    {
      name: "ddalab-open-files",
      partialize: (state) => ({
        files: state.files,
        activeFilePath: state.activeFilePath,
      }),
    },
  ),
);

/**
 * Selector hooks for common use cases
 */
export function useActiveFile(): OpenFile | null {
  return useOpenFilesStore((state) => {
    if (!state.activeFilePath) return null;
    return state.files.find((f) => f.filePath === state.activeFilePath) || null;
  });
}

export function useActiveFilePath(): string | null {
  return useOpenFilesStore((state) => state.activeFilePath);
}

export function useOpenFiles(): OpenFile[] {
  return useOpenFilesStore((state) => state.files);
}

export function useIsFileOpen(filePath: string): boolean {
  return useOpenFilesStore((state) =>
    state.files.some((f) => f.filePath === filePath),
  );
}

export function useOpenFilesCount(): number {
  return useOpenFilesStore((state) => state.files.length);
}
