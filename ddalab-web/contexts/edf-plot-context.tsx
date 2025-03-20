"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

// Define the types for the EDF plot state
interface EDFPlotState {
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
interface EDFPlotContextType {
  // Map to store state by filePath
  plotStates: Map<string, EDFPlotState>;
  // Function to get state for a specific file
  getPlotState: (filePath: string) => EDFPlotState | undefined;
  // Function to update state for a specific file
  updatePlotState: (filePath: string, state: Partial<EDFPlotState>) => void;
  // Function to create initial state for a new file
  initPlotState: (filePath: string) => void;
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
  chunkSizeSeconds: 10,
  selectedChannels: [],
  showPlot: false,
  timeWindow: [0, 10],
  absoluteTimeWindow: [0, 10],
  zoomLevel: 1,
  chunkStart: 0,
  totalSamples: 0,
  totalDuration: 0,
  currentChunkNumber: 1,
  totalChunks: 1,
  edfData: null,
  annotations: null,
  lastFetchTime: null,
  preprocessingOptions: null,
  sampleRate: 256, // Default sample rate
};

// Create the context with undefined default value
const EDFPlotContext = createContext<EDFPlotContextType | undefined>(undefined);

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
        newStates.set(filePath, { ...currentState, ...state });
        return newStates;
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

  // Value provided by the context
  const value = {
    plotStates,
    getPlotState,
    updatePlotState,
    initPlotState,
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
