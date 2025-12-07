/**
 * File Navigation Hook
 *
 * Synchronizes navigation state with the active file.
 * When the active file changes, restores that file's navigation state.
 * When navigation changes, saves to the active file's state.
 */

import { useEffect, useCallback, useRef } from "react";
import { useActiveFilePath } from "@/store/openFilesStore";
import { useAppStore } from "@/store/appStore";
import {
  useActiveFileNavigationState,
  useActiveFileContext,
} from "@/contexts/ActiveFileContext";
import { PrimaryNavTab, SecondaryNavTab } from "@/types/navigation";
import { createLogger } from "@/lib/logger";

const logger = createLogger("FileNavigation");

/**
 * Hook to synchronize navigation with the active file
 * Must be used within ActiveFileProvider
 */
export function useFileNavigation() {
  const activeFilePath = useActiveFilePath();
  const navigationState = useActiveFileNavigationState();
  const { updateNavigationState } = useActiveFileContext();

  // Get navigation actions from app store
  const setPrimaryNav = useAppStore((state) => state.setPrimaryNav);
  const setSecondaryNav = useAppStore((state) => state.setSecondaryNav);
  const currentPrimaryNav = useAppStore((state) => state.ui.primaryNav);
  const currentSecondaryNav = useAppStore((state) => state.ui.secondaryNav);

  // Track previous file to detect file changes
  const prevFilePathRef = useRef<string | null>(null);
  const isRestoringRef = useRef(false);

  // Restore navigation when active file changes
  useEffect(() => {
    if (!activeFilePath) {
      prevFilePathRef.current = null;
      return;
    }

    // Check if file actually changed
    if (activeFilePath === prevFilePathRef.current) {
      return;
    }

    prevFilePathRef.current = activeFilePath;

    // Restore navigation state if available
    if (navigationState) {
      isRestoringRef.current = true;
      logger.debug("Restoring navigation for file", {
        filePath: activeFilePath,
        nav: navigationState,
      });

      setPrimaryNav(navigationState.primaryNav);
      if (navigationState.secondaryNav) {
        setSecondaryNav(navigationState.secondaryNav);
      }

      // Reset flag after a tick
      setTimeout(() => {
        isRestoringRef.current = false;
      }, 0);
    }
  }, [activeFilePath, navigationState, setPrimaryNav, setSecondaryNav]);

  // Save navigation when it changes (but not during restoration)
  useEffect(() => {
    if (!activeFilePath || isRestoringRef.current) {
      return;
    }

    // Skip if navigation matches saved state
    if (
      navigationState?.primaryNav === currentPrimaryNav &&
      navigationState?.secondaryNav === currentSecondaryNav
    ) {
      return;
    }

    logger.debug("Saving navigation for file", {
      filePath: activeFilePath,
      primaryNav: currentPrimaryNav,
      secondaryNav: currentSecondaryNav,
    });

    updateNavigationState({
      primaryNav: currentPrimaryNav,
      secondaryNav: currentSecondaryNav,
    });
  }, [
    activeFilePath,
    currentPrimaryNav,
    currentSecondaryNav,
    navigationState,
    updateNavigationState,
  ]);
}

/**
 * Hook to navigate with file context awareness
 * Returns navigation functions that update both app state and file state
 */
export function useFileAwareNavigation() {
  const activeFilePath = useActiveFilePath();
  const { updateNavigationState } = useActiveFileContext();

  const setPrimaryNavApp = useAppStore((state) => state.setPrimaryNav);
  const setSecondaryNavApp = useAppStore((state) => state.setSecondaryNav);

  const setPrimaryNav = useCallback(
    (tab: PrimaryNavTab) => {
      setPrimaryNavApp(tab);

      if (activeFilePath) {
        updateNavigationState({ primaryNav: tab });
      }
    },
    [activeFilePath, setPrimaryNavApp, updateNavigationState],
  );

  const setSecondaryNav = useCallback(
    (tab: SecondaryNavTab | null) => {
      setSecondaryNavApp(tab);

      if (activeFilePath) {
        updateNavigationState({ secondaryNav: tab });
      }
    },
    [activeFilePath, setSecondaryNavApp, updateNavigationState],
  );

  return {
    setPrimaryNav,
    setSecondaryNav,
  };
}
