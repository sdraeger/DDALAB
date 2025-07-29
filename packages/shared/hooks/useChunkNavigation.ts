import { useState, useCallback, useEffect } from "react";
import { useAppSelector, useAppDispatch } from "../store";
import { selectPlotStateByPath, loadChunk } from "../store/slices/plotSlice";

interface UseChunkNavigationProps {
  filePath: string;
  sampleRate: number;
  totalSamples: number;
  token?: string;
}

interface UseChunkNavigationReturn {
  chunkStart: number;
  chunkSize: number;
  currentChunkNumber: number;
  totalChunks: number;
  setChunkStart: (start: number) => void;
  setChunkSize: (size: number) => void;
  handlePrevChunk: () => void;
  handleNextChunk: () => void;
  handleChunkSelect: (chunkNumber: number) => void;
  handleChunkSizeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const useChunkNavigation = ({
  filePath,
  sampleRate,
  totalSamples,
  token,
}: UseChunkNavigationProps): UseChunkNavigationReturn => {
  const dispatch = useAppDispatch();

  // Get plot state from Redux instead of context
  const plotState = useAppSelector((state) =>
    selectPlotStateByPath(state, filePath)
  );

  const [chunkStart, setChunkStart] = useState(0);
  const [chunkSize, setChunkSize] = useState(() => {
    // Ensure we always have a valid chunkSize
    if (plotState?.edfData?.sampleRate) {
      return Math.round(
        (plotState.chunkSizeSeconds || 10) * plotState.edfData.sampleRate
      );
    }
    // Fallback: use sampleRate parameter if available, otherwise default
    return sampleRate ? Math.round(10 * sampleRate) : 2560;
  });

  // Synchronize local state with Redux state changes
  useEffect(() => {
    if (plotState) {
      // Get sample rate from edfData or fallback to the prop
      const currentSampleRate = plotState.edfData?.sampleRate || sampleRate;

      // Update chunkStart when Redux state changes
      // Redux stores chunkStart in seconds, but we need it in samples for calculations
      if (plotState.chunkStart !== undefined) {
        const chunkStartInSamples = Math.round(
          plotState.chunkStart * currentSampleRate
        );
        if (chunkStartInSamples !== chunkStart) {
          setChunkStart(chunkStartInSamples);
        }
      }

      // Update chunkSize when Redux state changes
      if (currentSampleRate && plotState.chunkSizeSeconds) {
        const newChunkSize = Math.round(
          plotState.chunkSizeSeconds * currentSampleRate
        );
        if (newChunkSize !== chunkSize) {
          setChunkSize(newChunkSize);
        }
      }
    }
  }, [plotState, chunkStart, chunkSize, sampleRate]);

  const currentChunkNumber = Math.floor(chunkStart / chunkSize) + 1;
  const totalChunks = Math.ceil(totalSamples / chunkSize);

  // Debug logging for chunk calculation
  if (process.env.NODE_ENV === "development" && totalSamples > 0) {
    console.log(`[useChunkNavigation] File: ${filePath.split("/").pop()}`);
    console.log(
      `[useChunkNavigation] totalSamples: ${totalSamples}, chunkSize: ${chunkSize}, totalChunks: ${totalChunks}`
    );
  }

  const handlePrevChunk = useCallback(async () => {
    if (!token) {
      console.error(`[useChunkNavigation] No token provided for navigation`);
      return;
    }

    const newChunkStart = Math.max(0, chunkStart - chunkSize);
    const newChunkNumber = Math.floor(newChunkStart / chunkSize) + 1;

    try {
      await dispatch(
        loadChunk({
          filePath,
          chunkNumber: newChunkNumber,
          chunkSizeSeconds: plotState?.chunkSizeSeconds || 10,
          token,
          preprocessingOptions: plotState?.preprocessingOptions,
        })
      ).unwrap();
    } catch (error) {
      console.error(
        `[useChunkNavigation] Failed to load previous chunk:`,
        error
      );
    }
  }, [
    chunkStart,
    chunkSize,
    filePath,
    dispatch,
    plotState?.chunkSizeSeconds,
    plotState?.preprocessingOptions,
    token,
  ]);

  const handleNextChunk = useCallback(async () => {
    if (!token) {
      console.error(`[useChunkNavigation] No token provided for navigation`);
      return;
    }

    // Calculate the proposed new chunk start
    const proposedChunkStart = chunkStart + chunkSize;

    // Don't allow moving beyond the last valid chunk
    if (proposedChunkStart >= totalSamples) {
      console.log("CHUNK NAVIGATION: Already at or beyond the last chunk", {
        currentChunkStart: chunkStart,
        proposedChunkStart,
        totalSamples,
        chunkSize,
      });
      return; // Don't move if we're already at or beyond the last chunk
    }

    // Ensure the new chunk doesn't exceed totalSamples
    const maxAllowedChunkStart = Math.max(0, totalSamples - chunkSize);
    const newChunkStart = Math.min(proposedChunkStart, maxAllowedChunkStart);
    const newChunkNumber = Math.floor(newChunkStart / chunkSize) + 1;

    try {
      await dispatch(
        loadChunk({
          filePath,
          chunkNumber: newChunkNumber,
          chunkSizeSeconds: plotState?.chunkSizeSeconds || 10,
          token,
          preprocessingOptions: plotState?.preprocessingOptions,
        })
      ).unwrap();
    } catch (error) {
      console.error(`[useChunkNavigation] Failed to load next chunk:`, error);
    }
  }, [
    chunkStart,
    chunkSize,
    filePath,
    totalSamples,
    dispatch,
    plotState?.chunkSizeSeconds,
    plotState?.preprocessingOptions,
    token,
  ]);

  const handleChunkSelect = useCallback(
    async (chunkNumber: number) => {
      if (!token) {
        console.error(`[useChunkNavigation] No token provided for navigation`);
        return;
      }

      try {
        await dispatch(
          loadChunk({
            filePath,
            chunkNumber,
            chunkSizeSeconds: plotState?.chunkSizeSeconds || 10,
            token,
            preprocessingOptions: plotState?.preprocessingOptions,
          })
        ).unwrap();
      } catch (error) {
        console.error(
          `[useChunkNavigation] Failed to load chunk ${chunkNumber}:`,
          error
        );
      }
    },
    [
      filePath,
      dispatch,
      plotState?.chunkSizeSeconds,
      plotState?.preprocessingOptions,
      token,
    ]
  );

  const handleChunkSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newSize = Math.max(1, parseInt(e.target.value, 10) || 1);
      const newSizeInSamples = newSize * sampleRate;
      setChunkSize(newSizeInSamples);
      // Note: This would need a Redux action to update chunkSizeSeconds
      // For now, we'll just update local state
    },
    [sampleRate]
  );

  return {
    chunkStart,
    chunkSize,
    currentChunkNumber,
    totalChunks,
    setChunkStart,
    setChunkSize,
    handlePrevChunk,
    handleNextChunk,
    handleChunkSelect,
    handleChunkSizeChange,
  };
};
