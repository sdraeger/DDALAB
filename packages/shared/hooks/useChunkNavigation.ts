import { useState, useCallback } from "react";
import { useEDFPlot } from "../contexts/EDFPlotContext";

interface UseChunkNavigationProps {
  filePath: string;
  sampleRate: number;
  totalSamples: number;
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
}: UseChunkNavigationProps): UseChunkNavigationReturn => {
  const { getPlotState, updatePlotState } = useEDFPlot();

  const plotState = getPlotState(filePath);
  const [chunkStart, setChunkStart] = useState(plotState?.chunkStart || 0);
  const [chunkSize, setChunkSize] = useState(() => {
    // Ensure we always have a valid chunkSize
    if (plotState?.sampleRate) {
      return Math.round(10 * plotState.sampleRate);
    }
    // Fallback: use sampleRate parameter if available, otherwise default
    return sampleRate ? Math.round(10 * sampleRate) : 2560;
  });

  const currentChunkNumber = Math.floor(chunkStart / chunkSize) + 1;
  const totalChunks = Math.ceil(totalSamples / chunkSize);

  // Debug logging for chunk calculation
  if (process.env.NODE_ENV === "development" && totalSamples > 0) {
    console.log(`[useChunkNavigation] File: ${filePath.split("/").pop()}`);
    console.log(
      `[useChunkNavigation] totalSamples: ${totalSamples}, chunkSize: ${chunkSize}, totalChunks: ${totalChunks}`
    );
  }

  const handlePrevChunk = useCallback(() => {
    const newChunkStart = Math.max(0, chunkStart - chunkSize);
    setChunkStart(newChunkStart);
    updatePlotState(filePath, { chunkStart: newChunkStart });
  }, [chunkStart, chunkSize, filePath, updatePlotState]);

  const handleNextChunk = useCallback(() => {
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

    setChunkStart(newChunkStart);
    updatePlotState(filePath, { chunkStart: newChunkStart });
  }, [chunkStart, chunkSize, filePath, totalSamples, updatePlotState]);

  const handleChunkSelect = useCallback(
    (chunkNumber: number) => {
      const newChunkStart = (chunkNumber - 1) * chunkSize;
      const clampedChunkStart = Math.max(
        0,
        Math.min(totalSamples - chunkSize, newChunkStart)
      );
      setChunkStart(clampedChunkStart);
      updatePlotState(filePath, { chunkStart: clampedChunkStart });
    },
    [chunkSize, filePath, totalSamples, updatePlotState]
  );

  const handleChunkSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newSize = Math.max(1, parseInt(e.target.value, 10) || 1);
      const newSizeInSamples = newSize * sampleRate;
      setChunkSize(newSizeInSamples);
      updatePlotState(filePath, { chunkSizeSeconds: newSize });
    },
    [filePath, sampleRate, updatePlotState]
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
