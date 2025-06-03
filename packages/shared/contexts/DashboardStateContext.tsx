"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import logger from "../lib/utils/logger";

interface DashboardState {
  selectedFilePath: string | null;
  fileBrowserCollapsed: boolean;
  selectedChannels: string[];
  lastActivity: number;
}

interface DashboardStateContextType {
  selectedFilePath: string | null;
  fileBrowserCollapsed: boolean;
  selectedChannels: string[];
  setSelectedFilePath: (filePath: string | null) => void;
  setFileBrowserCollapsed: (collapsed: boolean) => void;
  setSelectedChannels: (channels: string[]) => void;
  toggleFileBrowser: () => void;
  clearDashboardState: () => void;
  handleFileSelect: (filePath: string) => void;
}

const DashboardStateContext = createContext<
  DashboardStateContextType | undefined
>(undefined);

export function useDashboardState() {
  const context = useContext(DashboardStateContext);
  if (!context) {
    throw new Error(
      "useDashboardState must be used within a DashboardStateProvider"
    );
  }
  return context;
}

const STORAGE_KEY = "dashboard-state";
const STATE_TTL = 2 * 60 * 60 * 1000; // 2 hours

const initialState: DashboardState = {
  selectedFilePath: null,
  fileBrowserCollapsed: false,
  selectedChannels: [],
  lastActivity: Date.now(),
};

export function DashboardStateProvider({ children }: { children: ReactNode }) {
  const [dashboardState, setDashboardState] =
    useState<DashboardState>(initialState);

  // Load state from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsedState = JSON.parse(saved) as DashboardState;

        // Check if state is still valid (not older than TTL)
        const isStateValid = Date.now() - parsedState.lastActivity < STATE_TTL;

        if (isStateValid) {
          setDashboardState(parsedState);
          logger.info("Restored dashboard state:", parsedState);
        } else {
          logger.info("Dashboard state expired, using initial state");
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch (error) {
      logger.error("Error loading dashboard state:", error);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboardState));
    } catch (error) {
      logger.error("Error saving dashboard state:", error);
    }
  }, [dashboardState]);

  // Update last activity whenever state changes
  const updateState = useCallback((updates: Partial<DashboardState>) => {
    setDashboardState((prev) => ({
      ...prev,
      ...updates,
      lastActivity: Date.now(),
    }));
  }, []);

  const setSelectedFilePath = useCallback(
    (filePath: string | null) => {
      updateState({ selectedFilePath: filePath });
      logger.info("Dashboard: Selected file path updated:", filePath);
    },
    [updateState]
  );

  const setFileBrowserCollapsed = useCallback(
    (collapsed: boolean) => {
      updateState({ fileBrowserCollapsed: collapsed });
      logger.info("Dashboard: File browser collapsed state:", collapsed);
    },
    [updateState]
  );

  const setSelectedChannels = useCallback(
    (channels: string[]) => {
      updateState({ selectedChannels: channels });
      logger.info("Dashboard: Selected channels updated:", channels.length);
    },
    [updateState]
  );

  const toggleFileBrowser = useCallback(() => {
    const newCollapsed = !dashboardState.fileBrowserCollapsed;
    setFileBrowserCollapsed(newCollapsed);
  }, [dashboardState.fileBrowserCollapsed, setFileBrowserCollapsed]);

  const handleFileSelect = useCallback(
    (filePath: string) => {
      setSelectedFilePath(filePath);
      setFileBrowserCollapsed(true);
      logger.info("Dashboard: File selected and browser collapsed:", filePath);
    },
    [setSelectedFilePath, setFileBrowserCollapsed]
  );

  const clearDashboardState = useCallback(() => {
    setDashboardState(initialState);
    localStorage.removeItem(STORAGE_KEY);
    logger.info("Dashboard state cleared");
  }, []);

  const value: DashboardStateContextType = {
    selectedFilePath: dashboardState.selectedFilePath,
    fileBrowserCollapsed: dashboardState.fileBrowserCollapsed,
    selectedChannels: dashboardState.selectedChannels,
    setSelectedFilePath,
    setFileBrowserCollapsed,
    setSelectedChannels,
    toggleFileBrowser,
    clearDashboardState,
    handleFileSelect,
  };

  return (
    <DashboardStateContext.Provider value={value}>
      {children}
    </DashboardStateContext.Provider>
  );
}
