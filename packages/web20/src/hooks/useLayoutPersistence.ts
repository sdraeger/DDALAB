import { useEffect, useRef, useCallback, useState } from "react";
import { useAppDispatch, useWidgets } from "@/store/hooks";
import {
  setWidgets,
  addWidget,
  removeWidget,
  updateWidget,
} from "@/store/slices/dashboardSlice";
import { LayoutPersistenceService } from "@/services/LayoutPersistenceService";
import { useAuthMode } from "@/contexts/AuthModeContext";
import logger from "@/lib/utils/logger";
import { useUnifiedSessionData } from "@/hooks/useUnifiedSession";

// Module-level guards to prevent duplicate initialization and loads
let serviceInitializedOnce = false;
let layoutLoadedOnce = false;
let isCurrentlyLoading = false;

interface UseLayoutPersistenceOptions {
  autoInit?: boolean;
  autoLoad?: boolean;
}

export function useLayoutPersistence(
  options: UseLayoutPersistenceOptions = {}
) {
  const { autoInit = true, autoLoad = true } = options;
  const dispatch = useAppDispatch();
  const widgets = useWidgets();
  const { data: session } = useUnifiedSessionData();
  const { isMultiUserMode } = useAuthMode();

  const persistenceService = useRef(LayoutPersistenceService.getInstance());
  const isInitializedRef = useRef(false);
  const [initialized, setInitialized] = useState(false);
  const userModifiedRef = useRef(false);

  // Initialize persistence service (once globally unless disabled)
  useEffect(() => {
    if (!autoInit) return;
    if (serviceInitializedOnce) return;
    serviceInitializedOnce = true;

    persistenceService.current.setDispatch(dispatch);

    // Set authentication token
    const token = session?.accessToken || session?.data?.accessToken || null;
    persistenceService.current.setAccessToken(token);

    // Set local mode flag
    persistenceService.current.setLocalMode(!isMultiUserMode);

    logger.info("LayoutPersistenceService initialized", {
      hasToken: !!token,
      isLocalMode: !isMultiUserMode,
      isMultiUserMode,
    });
  }, [dispatch, session, isMultiUserMode, autoInit]);

  // Load layout on mount (once globally unless disabled)
  useEffect(() => {
    if (!autoLoad) {
      // If we skip autoLoad, consider initialized for this consumer
      setInitialized(true);
      return;
    }
    if (layoutLoadedOnce) {
      setInitialized(true);
      return;
    }
    if (isCurrentlyLoading) {
      // Another instance is already loading
      return;
    }
    if (!isInitializedRef.current && (session || !isMultiUserMode)) {
      isInitializedRef.current = true;
      isCurrentlyLoading = true;

      persistenceService.current
        .loadLayout()
        .then((loadedWidgets) => {
          try {
            if (userModifiedRef.current) {
              // User added/changed widgets before load completed; do not overwrite
              logger.info(
                "Skipping layout overwrite because user modified widgets during load"
              );
              return;
            }
            if (loadedWidgets.length > 0) {
              // Use setTimeout to prevent infinite loop during React render cycle
              setTimeout(() => {
                dispatch(setWidgets(loadedWidgets));
              }, 0);
              layoutLoadedOnce = true;
              logger.info(
                "Loaded saved layout with widgets:",
                loadedWidgets.length
              );
            } else {
              logger.info("No saved layout found, using default widgets");
              layoutLoadedOnce = true;
            }
          } finally {
            setInitialized(true);
          }
        })
        .catch((error) => {
          logger.error("Failed to load layout:", error);
          setInitialized(true);
        })
        .finally(() => {
          isCurrentlyLoading = false;
        });
    }
  }, [dispatch, session, isMultiUserMode, autoLoad]);

  // Auto-save on widget changes
  useEffect(() => {
    if (initialized && widgets.length > 0 && layoutLoadedOnce) {
      // Only auto-save after initial layout has been loaded
      persistenceService.current.scheduleAutoSave(widgets);
    }
  }, [widgets, initialized]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      persistenceService.current.clearAutoSaveTimer();
    };
  }, []);

  // Enhanced widget management functions with persistence
  const addWidgetWithPersistence = useCallback(
    (widget: any) => {
      userModifiedRef.current = true;
      dispatch(addWidget(widget));
      // Auto-save is handled by the useEffect above
    },
    [dispatch]
  );

  const removeWidgetWithPersistence = useCallback(
    (widgetId: string) => {
      dispatch(removeWidget(widgetId));
      // Auto-save is handled by the useEffect above
    },
    [dispatch]
  );

  const updateWidgetWithPersistence = useCallback(
    (widgetId: string, updates: any) => {
      dispatch(updateWidget({ id: widgetId, updates }));
      // Auto-save is handled by the useEffect above
    },
    [dispatch]
  );

  const saveLayout = useCallback(async () => {
    try {
      await persistenceService.current.saveCurrentLayout(widgets);
      logger.info("Layout saved manually");
    } catch (error) {
      logger.error("Failed to save layout manually:", error);
      throw error;
    }
  }, [widgets]);

  const loadLayout = useCallback(async () => {
    try {
      const loadedWidgets = await persistenceService.current.loadLayout();
      if (loadedWidgets.length > 0) {
        dispatch(setWidgets(loadedWidgets));
        logger.info("Layout loaded manually");
      }
    } catch (error) {
      logger.error("Failed to load layout manually:", error);
      throw error;
    }
  }, [dispatch]);

  const clearLayout = useCallback(async () => {
    try {
      await persistenceService.current.deleteLayout();
      dispatch(setWidgets([]));
      logger.info("Layout cleared");
    } catch (error) {
      logger.error("Failed to clear layout:", error);
      throw error;
    }
  }, [dispatch]);

  return {
    addWidget: addWidgetWithPersistence,
    removeWidget: removeWidgetWithPersistence,
    updateWidget: updateWidgetWithPersistence,
    saveLayout,
    loadLayout,
    clearLayout,
    isInitialized: initialized,
  };
}
