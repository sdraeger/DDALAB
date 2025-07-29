"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

import {
  DEFAULT_CHUNK_SIZE_SECONDS,
  DEFAULT_SELECTED_CHANNELS,
  DEFAULT_TIME_WINDOW,
  DEFAULT_ABSOLUTE_TIME_WINDOW,
  DEFAULT_ZOOM_LEVEL,
  DEFAULT_CURRENT_CHUNK_NUMBER,
  DEFAULT_TOTAL_CHUNKS,
  DEFAULT_CHUNK_START,
  DEFAULT_ANNOTATIONS,
  DEFAULT_PREPROCESSING_OPTIONS,
} from "../lib/utils/plotDefaults";

// Define the types for the EDF plot state
export interface EDFPlotState {
  chunkSizeSeconds: number;
  selectedChannels: string[];
  showPlot: boolean;
  timeWindow: [number, number];
  absoluteTimeWindow: [number, number];
  zoomLevel: number;
  chunkStart: number;
  totalSamples: number;
  totalDuration: number;
  currentChunkNumber: number;
  totalChunks: number;
  edfData: any | null; // Cache for the loaded EDF data
  annotations: any[] | null; // Cache for annotations
  lastFetchTime: number | null; // Timestamp of last fetch
  preprocessingOptions: any | null; // Store preprocessing options
  sampleRate: number; // Sample rate of the EDF file
}

// Create a context for the EDF plot state
export interface EDFPlotContext {
  // Map to store state by filePath
  plotStates: Map<string, EDFPlotState>;
  // Function to get state for a specific file
  getPlotState: (filePath: string) => EDFPlotState | undefined;
  // Function to update state for a specific file
  updatePlotState: (filePath: string, state: Partial<EDFPlotState>) => void;
  // Function to create initial state for a new file
  initPlotState: (filePath: string) => void;
  // Function to clear all plot states
  clearAllPlotStates: () => void;
  // Currently selected file path
  selectedFilePath: string;
  // Update selected file path
  setSelectedFilePath: (filePath: string) => void;
  // Dialog open state
  plotDialogOpen: boolean;
  // Update dialog open state
  setPlotDialogOpen: (open: boolean) => void;
}

// Default values for EDF plot state
const defaultPlotState: EDFPlotState = {
  chunkSizeSeconds: DEFAULT_CHUNK_SIZE_SECONDS,
  selectedChannels: DEFAULT_SELECTED_CHANNELS,
  showPlot: false,
  timeWindow: DEFAULT_TIME_WINDOW,
  absoluteTimeWindow: DEFAULT_ABSOLUTE_TIME_WINDOW,
  zoomLevel: DEFAULT_ZOOM_LEVEL,
  chunkStart: DEFAULT_CHUNK_START,
  totalSamples: 0,
  totalDuration: 0,
  currentChunkNumber: DEFAULT_CURRENT_CHUNK_NUMBER,
  totalChunks: DEFAULT_TOTAL_CHUNKS,
  edfData: null,
  annotations: DEFAULT_ANNOTATIONS,
  lastFetchTime: null,
  preprocessingOptions: DEFAULT_PREPROCESSING_OPTIONS,
  sampleRate: 256,
};

// Create the context with undefined default value
export const EDFPlotContext = createContext<EDFPlotContext | undefined>(
  undefined
);

// Provider component
export function EDFPlotProvider({ children }: { children: ReactNode }) {
  // Store the plot states for different files
  const [plotStates, setPlotStates] = useState<Map<string, EDFPlotState>>(
    new Map()
  );
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");
  const [plotDialogOpen, setPlotDialogOpen] = useState<boolean>(false);

  // Get plot state for a specific file - memoize to avoid recreating on each render
  const getPlotState = useCallback(
    (filePath: string) => {
      return plotStates.get(filePath);
    },
    [plotStates]
  );

  // Update plot state for a specific file - memoize to avoid recreating on each render
  const updatePlotState = useCallback(
    (filePath: string, state: Partial<EDFPlotState>) => {
      setPlotStates((prevStates) => {
        const newStates = new Map(prevStates);
        const currentState = newStates.get(filePath) || { ...defaultPlotState };

        // Check if any values have actually changed
        let hasChanges = false;
        for (const [key, value] of Object.entries(state)) {
          if (currentState[key as keyof EDFPlotState] !== value) {
            hasChanges = true;
            break;
          }
        }

        // Only update if there are actual changes
        if (hasChanges) {
          newStates.set(filePath, { ...currentState, ...state });
          return newStates;
        }

        // Return the same Map if no changes
        return prevStates;
      });
    },
    []
  );

  // Initialize plot state for a new file - memoize to avoid recreating on each render
  const initPlotState = useCallback((filePath: string) => {
    setPlotStates((prevStates) => {
      // Only initialize if it doesn't exist
      if (!prevStates.has(filePath)) {
        const newStates = new Map(prevStates);
        newStates.set(filePath, { ...defaultPlotState });
        return newStates;
      }
      return prevStates;
    });
  }, []);

  // Clear all plot states - memoize to avoid recreating on each render
  const clearAllPlotStates = useCallback(() => {
    setPlotStates(new Map());
    setSelectedFilePath("");
  }, [setSelectedFilePath]);

  // Value provided by the context
  const value = {
    plotStates,
    getPlotState,
    updatePlotState,
    initPlotState,
    clearAllPlotStates,
    selectedFilePath,
    setSelectedFilePath,
    plotDialogOpen,
    setPlotDialogOpen,
  };

  return (
    <EDFPlotContext.Provider value={value}>{children}</EDFPlotContext.Provider>
  );
}

// Custom hook to use the EDF plot context
export function useEDFPlot() {
  const context = useContext(EDFPlotContext);
  if (context === undefined) {
    throw new Error("useEDFPlot must be used within an EDFPlotProvider");
  }
  return context;
}
