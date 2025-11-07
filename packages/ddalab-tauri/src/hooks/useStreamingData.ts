/**
 * useStreamingData Hook
 *
 * Custom React hook for managing streaming data subscriptions
 * and coordinating with the streaming service.
 */

import { useEffect, useCallback, useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { StreamSourceConfig, StreamingDDAConfig } from "@/types/streaming";

export function useStreamingData(streamId: string | null) {
  const streaming = useAppStore((state) => state.streaming);
  const createStreamSession = useAppStore((state) => state.createStreamSession);
  const stopStreamSession = useAppStore((state) => state.stopStreamSession);
  const pauseStreamSession = useAppStore((state) => state.pauseStreamSession);
  const resumeStreamSession = useAppStore((state) => state.resumeStreamSession);
  const clearStreamPlotData = useAppStore((state) => state.clearStreamPlotData);

  const session = streamId ? streaming.sessions[streamId] : null;
  const plotData = streamId ? streaming.plotData[streamId] : null;

  // Derived state (note: backend uses capital letters)
  const isRunning = session?.state.type === "Running";
  const isPaused = session?.state.type === "Paused";
  const hasError = session?.state.type === "Error";
  const isConnecting = session?.state.type === "Connecting";

  // Get latest data chunks
  const latestChunks = useMemo(() => {
    return plotData?.dataChunks || [];
  }, [plotData?.dataChunks]);

  // Get latest DDA results
  const latestResults = useMemo(() => {
    return plotData?.ddaResults || [];
  }, [plotData?.ddaResults]);

  // Get statistics
  const stats = session?.stats;

  return {
    session,
    plotData,
    latestChunks,
    latestResults,
    stats,
    isRunning,
    isPaused,
    hasError,
    isConnecting,
    createStream: createStreamSession,
    stopStream: stopStreamSession,
    pauseStream: pauseStreamSession,
    resumeStream: resumeStreamSession,
    clearData: clearStreamPlotData,
  };
}

/**
 * Hook to automatically manage stream lifecycle
 */
export function useStreamLifecycle(
  streamId: string | null,
  options?: {
    autoCleanup?: boolean;
  },
) {
  const { autoCleanup = true } = options || {};
  const stopStream = useAppStore((state) => state.stopStreamSession);
  const removeSession = useAppStore((state) => state.removeStreamSession);

  useEffect(() => {
    if (!streamId || !autoCleanup) return;

    return () => {
      // Cleanup on unmount
      stopStream(streamId)
        .then(() => {
          removeSession(streamId);
        })
        .catch((err) => {
          console.error(`Failed to cleanup stream ${streamId}:`, err);
        });
    };
  }, [streamId, autoCleanup, stopStream, removeSession]);
}

/**
 * Hook to get all active streaming sessions
 */
export function useActiveStreams() {
  const sessions = useAppStore((state) => state.streaming.sessions);

  const activeSessions = useMemo(() => {
    return Object.values(sessions).filter(
      (s) => s.state.type === "Running" || s.state.type === "Paused",
    );
  }, [sessions]);

  const runningSessions = useMemo(() => {
    return Object.values(sessions).filter((s) => s.state.type === "Running");
  }, [sessions]);

  return {
    allSessions: Object.values(sessions),
    activeSessions,
    runningSessions,
    sessionCount: Object.keys(sessions).length,
    activeCount: activeSessions.length,
    runningCount: runningSessions.length,
  };
}
