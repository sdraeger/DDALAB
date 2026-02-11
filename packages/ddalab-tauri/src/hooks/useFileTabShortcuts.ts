/**
 * File Tab Keyboard Shortcuts
 *
 * Provides keyboard shortcuts for file tab management:
 * - Ctrl+Tab: Next tab
 * - Ctrl+Shift+Tab: Previous tab
 * - Cmd/Ctrl+1-9: Switch to tab by index
 */

import { useEffect, useCallback } from "react";
import { useOpenFilesStore } from "@/store/openFilesStore";

/**
 * Hook that registers keyboard shortcuts for file tab management
 */
export function useFileTabShortcuts() {
  const files = useOpenFilesStore((state) => state.files);
  const activeFilePath = useOpenFilesStore((state) => state.activeFilePath);
  const setActiveFile = useOpenFilesStore((state) => state.setActiveFile);
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      // Don't intercept if user is typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // Ctrl+Tab: Next tab (works on both Mac and Windows)
      if (e.ctrlKey && e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        if (files.length <= 1) return;

        const currentIndex = files.findIndex(
          (f) => f.filePath === activeFilePath,
        );
        const nextIndex = (currentIndex + 1) % files.length;
        setActiveFile(files[nextIndex].filePath);
        return;
      }

      // Ctrl+Shift+Tab: Previous tab
      if (e.ctrlKey && e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        if (files.length <= 1) return;

        const currentIndex = files.findIndex(
          (f) => f.filePath === activeFilePath,
        );
        const prevIndex = (currentIndex - 1 + files.length) % files.length;
        setActiveFile(files[prevIndex].filePath);
        return;
      }

      // Cmd/Ctrl+1-9: Switch to tab by index
      if (modKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const tabIndex = parseInt(e.key, 10) - 1;
        if (tabIndex < files.length) {
          setActiveFile(files[tabIndex].filePath);
        }
        return;
      }
    },
    [files, activeFilePath, setActiveFile],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}
