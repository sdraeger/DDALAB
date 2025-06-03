"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { plotCacheManager } from "../lib/utils/plotCache";
import logger from "../lib/utils/logger";

export interface PersistentPlot {
  id: string;
  filePath: string;
  fileName: string;
  isMinimized: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  lastAccessed: number;
  plotType: "eeg" | "dda";
  isVisible: boolean;
}

interface PersistentPlotsContextType {
  openPlots: PersistentPlot[];
  addPlot: (
    plot: Omit<PersistentPlot, "id" | "lastAccessed" | "isVisible">
  ) => string;
  removePlot: (plotId: string) => void;
  updatePlot: (plotId: string, updates: Partial<PersistentPlot>) => void;
  togglePlotVisibility: (plotId: string) => void;
  minimizePlot: (plotId: string) => void;
  maximizePlot: (plotId: string) => void;
  getPlot: (plotId: string) => PersistentPlot | undefined;
  clearAllPlots: () => void;
  restorePlot: (plotId: string) => void;
}

const PersistentPlotsContext = createContext<
  PersistentPlotsContextType | undefined
>(undefined);

export function usePersistentPlots() {
  const context = useContext(PersistentPlotsContext);
  if (!context) {
    throw new Error(
      "usePersistentPlots must be used within a PersistentPlotsProvider"
    );
  }
  return context;
}

const STORAGE_KEY = "persistent-plots";
const MAX_PLOTS = 5; // Limit number of concurrent plots

export function PersistentPlotsProvider({ children }: { children: ReactNode }) {
  const [openPlots, setOpenPlots] = useState<PersistentPlot[]>([]);

  // Load plots from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsedPlots = JSON.parse(saved) as PersistentPlot[];
        // Validate and clean up old plots (older than 1 hour)
        const validPlots = parsedPlots.filter(
          (plot) => Date.now() - plot.lastAccessed < 60 * 60 * 1000
        );
        setOpenPlots(validPlots);
        logger.info(`Restored ${validPlots.length} persistent plots`);
      }
    } catch (error) {
      logger.error("Error loading persistent plots:", error);
    }
  }, []);

  // Save plots to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(openPlots));
    } catch (error) {
      logger.error("Error saving persistent plots:", error);
    }
  }, [openPlots]);

  const generatePlotId = useCallback((filePath: string): string => {
    return `plot_${Date.now()}_${btoa(filePath).slice(0, 8)}`;
  }, []);

  const addPlot = useCallback(
    (
      plotData: Omit<PersistentPlot, "id" | "lastAccessed" | "isVisible">
    ): string => {
      // Check if plot already exists for this file
      const existingPlot = openPlots.find(
        (plot) => plot.filePath === plotData.filePath
      );
      if (existingPlot) {
        // Update existing plot and bring to front
        setOpenPlots((prev) =>
          prev.map((plot) =>
            plot.id === existingPlot.id
              ? {
                  ...plot,
                  lastAccessed: Date.now(),
                  isVisible: true,
                  isMinimized: false,
                }
              : plot
          )
        );
        return existingPlot.id;
      }

      // Remove oldest plot if we're at the limit
      if (openPlots.length >= MAX_PLOTS) {
        const oldestPlot = openPlots.reduce((oldest, current) =>
          current.lastAccessed < oldest.lastAccessed ? current : oldest
        );
        setOpenPlots((prev) =>
          prev.filter((plot) => plot.id !== oldestPlot.id)
        );
        logger.info(`Removed oldest plot: ${oldestPlot.fileName}`);
      }

      const newId = generatePlotId(plotData.filePath);
      const newPlot: PersistentPlot = {
        ...plotData,
        id: newId,
        lastAccessed: Date.now(),
        isVisible: true,
      };

      setOpenPlots((prev) => [...prev, newPlot]);
      logger.info(`Added persistent plot: ${plotData.fileName}`);
      return newId;
    },
    [openPlots, generatePlotId]
  );

  const removePlot = useCallback((plotId: string) => {
    setOpenPlots((prev) => {
      const plot = prev.find((p) => p.id === plotId);
      if (plot) {
        // Clear cache for this plot
        plotCacheManager.clearFileCache(plot.filePath);
        logger.info(`Removed persistent plot: ${plot.fileName}`);
      }
      return prev.filter((plot) => plot.id !== plotId);
    });
  }, []);

  const updatePlot = useCallback(
    (plotId: string, updates: Partial<PersistentPlot>) => {
      setOpenPlots((prev) =>
        prev.map((plot) =>
          plot.id === plotId
            ? { ...plot, ...updates, lastAccessed: Date.now() }
            : plot
        )
      );
    },
    []
  );

  const togglePlotVisibility = useCallback((plotId: string) => {
    setOpenPlots((prev) =>
      prev.map((plot) =>
        plot.id === plotId
          ? { ...plot, isVisible: !plot.isVisible, lastAccessed: Date.now() }
          : plot
      )
    );
  }, []);

  const minimizePlot = useCallback(
    (plotId: string) => {
      updatePlot(plotId, { isMinimized: true, isVisible: false });
    },
    [updatePlot]
  );

  const maximizePlot = useCallback(
    (plotId: string) => {
      updatePlot(plotId, { isMinimized: false, isVisible: true });
    },
    [updatePlot]
  );

  const restorePlot = useCallback(
    (plotId: string) => {
      updatePlot(plotId, { isMinimized: false, isVisible: true });
    },
    [updatePlot]
  );

  const getPlot = useCallback(
    (plotId: string): PersistentPlot | undefined => {
      return openPlots.find((plot) => plot.id === plotId);
    },
    [openPlots]
  );

  const clearAllPlots = useCallback(() => {
    // Clear cache for all plots
    openPlots.forEach((plot) => {
      plotCacheManager.clearFileCache(plot.filePath);
    });
    setOpenPlots([]);
    logger.info("Cleared all persistent plots");
  }, [openPlots]);

  const value: PersistentPlotsContextType = {
    openPlots,
    addPlot,
    removePlot,
    updatePlot,
    togglePlotVisibility,
    minimizePlot,
    maximizePlot,
    getPlot,
    clearAllPlots,
    restorePlot,
  };

  return (
    <PersistentPlotsContext.Provider value={value}>
      {children}
    </PersistentPlotsContext.Provider>
  );
}
