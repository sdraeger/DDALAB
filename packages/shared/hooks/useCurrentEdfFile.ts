import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import {
  ensurePlotState,
  setCurrentFilePath,
  setSelectedChannels,
  selectCurrentFilePath,
  selectCurrentPlotState,
  selectCurrentEdfData,
  selectCurrentChunkMetadata,
} from "../store/slices/plotSlice";

/**
 * Custom hook for managing the currently selected EDF file and its state.
 * Ensures state is initialized and provides helpers for file/channel selection.
 */
export function useCurrentEdfFile() {
  const dispatch = useAppDispatch();
  const currentFilePath = useAppSelector(selectCurrentFilePath);
  const currentPlotState = useAppSelector(selectCurrentPlotState);
  const currentEdfData = useAppSelector(selectCurrentEdfData);
  const currentChunkMetadata = useAppSelector(selectCurrentChunkMetadata);

  // Debug logging for DDA results
  console.log("[useCurrentEdfFile] Current state:", {
    currentFilePath,
    hasCurrentPlotState: !!currentPlotState,
    hasDdaResults: !!currentPlotState?.ddaResults,
    ddaResultsQ: currentPlotState?.ddaResults?.Q,
    ddaResultsQLength: currentPlotState?.ddaResults?.Q?.length,
    // Check file path matching
    storedFilePath: currentPlotState?.ddaResults?.file_path,
    pathMatch: currentFilePath === currentPlotState?.ddaResults?.file_path,
    // Check all available plot states
    availablePlotPaths: Object.keys(
      currentPlotState ? { [currentFilePath || ""]: currentPlotState } : {}
    ),
  });

  // Select a file and ensure its state exists
  const selectFile = useCallback(
    (filePath: string) => {
      dispatch(ensurePlotState(filePath));
      dispatch(setCurrentFilePath(filePath));
    },
    [dispatch]
  );

  // Select channels for the current file
  const selectChannels = useCallback(
    (channels: string[]) => {
      if (!currentFilePath) return;
      dispatch(setSelectedChannels({ filePath: currentFilePath, channels }));
    },
    [dispatch, currentFilePath]
  );

  return {
    currentFilePath,
    currentPlotState,
    currentEdfData,
    currentChunkMetadata,
    selectFile,
    selectChannels,
  };
}
