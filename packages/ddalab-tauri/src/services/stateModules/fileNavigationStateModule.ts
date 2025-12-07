/**
 * File Navigation State Module
 *
 * Manages per-file navigation state.
 * Each file remembers its navigation position (primary/secondary tabs)
 * so switching between files restores the user's context.
 */

import { invoke } from "@tauri-apps/api/core";
import { FileStateModule } from "@/types/fileCentricState";
import { PrimaryNavTab, SecondaryNavTab } from "@/types/navigation";

/**
 * Navigation state for a specific file
 */
export interface FileNavigationState {
  /** Current primary navigation tab */
  primaryNav: PrimaryNavTab;
  /** Current secondary navigation tab (if applicable) */
  secondaryNav: SecondaryNavTab | null;
  /** Sidebar section that was active */
  sidebarSection: string | null;
  /** Scroll positions for content areas */
  scrollPositions?: Record<string, number>;
  /** Last update timestamp */
  lastUpdated: string;
}

export class FileNavigationStateModule
  implements FileStateModule<FileNavigationState>
{
  readonly moduleId = "navigation";

  async loadState(filePath: string): Promise<FileNavigationState | null> {
    try {
      return await invoke<FileNavigationState>("get_file_navigation_state", {
        filePath,
      });
    } catch {
      return null;
    }
  }

  async saveState(filePath: string, state: FileNavigationState): Promise<void> {
    await invoke("save_file_navigation_state", { filePath, state });
  }

  async clearState(filePath: string): Promise<void> {
    try {
      await invoke("clear_file_navigation_state", { filePath });
    } catch {
      // State may not exist, ignore
    }
  }

  getDefaultState(): FileNavigationState {
    return {
      primaryNav: "explore",
      secondaryNav: "timeseries",
      sidebarSection: null,
      scrollPositions: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  validateState(state: unknown): state is FileNavigationState {
    if (typeof state !== "object" || state === null) return false;

    const s = state as Record<string, unknown>;

    return (
      typeof s.primaryNav === "string" &&
      (s.secondaryNav === null || typeof s.secondaryNav === "string") &&
      (s.sidebarSection === null || typeof s.sidebarSection === "string")
    );
  }
}
