import { useEffect, useMemo, useRef, useState } from "react";
import type { ChunkData } from "@/types/api";
import {
  useOverviewData,
  useOverviewProgress,
} from "@/hooks/useTimeSeriesData";

const OVERVIEW_LOAD_TIMEOUT_MS = 8_000;

export interface OverviewProgressState {
  hasCache: boolean;
  completionPercentage: number;
  isComplete: boolean;
}

interface UseOverviewControllerParams {
  filePath: string;
  channels: string[];
  maxPoints?: number;
  enabled?: boolean;
}

interface UseOverviewControllerResult {
  overviewData: ChunkData | null;
  overviewLoading: boolean;
  overviewError: string | null;
  overviewProgress: OverviewProgressState | undefined;
  refetchOverview: () => void;
}

function hasValidOverviewData(data: ChunkData | null): boolean {
  if (!data || !Array.isArray(data.data) || data.data.length === 0) {
    return false;
  }
  return data.data.every(
    (channelData) => Array.isArray(channelData) && channelData.length > 0,
  );
}

function deferStateUpdate(update: () => void): () => void {
  const timeoutId = window.setTimeout(update, 0);
  return () => {
    window.clearTimeout(timeoutId);
  };
}

export function useOverviewController({
  filePath,
  channels,
  maxPoints = 2000,
  enabled = true,
}: UseOverviewControllerParams): UseOverviewControllerResult {
  const overviewEnabled = Boolean(enabled && filePath && channels.length > 0);
  const requestedChannelKey = useMemo(() => channels.join("|"), [channels]);
  const requestKey = useMemo(
    () => `${filePath}|${channels.join("|")}|${maxPoints}`,
    [filePath, channels, maxPoints],
  );

  const [pendingRequestKey, setPendingRequestKey] = useState<string | null>(
    null,
  );
  const [timedOutRequestKey, setTimedOutRequestKey] = useState<string | null>(
    null,
  );
  const previousCompleteRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (!overviewEnabled) {
      return deferStateUpdate(() => {
        setPendingRequestKey(null);
        setTimedOutRequestKey(null);
      });
    }

    return deferStateUpdate(() => {
      setTimedOutRequestKey(null);
      setPendingRequestKey(requestKey);
    });
  }, [overviewEnabled, requestKey]);

  useEffect(() => {
    if (!overviewEnabled || pendingRequestKey !== requestKey) return;

    const timeoutId = window.setTimeout(() => {
      setTimedOutRequestKey(requestKey);
      setPendingRequestKey(null);
    }, OVERVIEW_LOAD_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [overviewEnabled, pendingRequestKey, requestKey]);

  const overviewQuery = useOverviewData(
    filePath,
    channels,
    maxPoints,
    overviewEnabled,
  );

  const overviewData = useMemo(() => {
    if (!overviewQuery.data || !filePath) return null;
    if (overviewQuery.data.file_path !== filePath) return null;
    const responseChannelKey = (overviewQuery.data.channels || []).join("|");
    if (responseChannelKey !== requestedChannelKey) return null;
    return overviewQuery.data;
  }, [overviewQuery.data, filePath, requestedChannelKey]);

  const overviewHasValidData = useMemo(
    () => hasValidOverviewData(overviewData),
    [overviewData],
  );

  const baseOverviewError = useMemo(() => {
    if (!overviewQuery.error) return null;
    return overviewQuery.error instanceof Error
      ? overviewQuery.error.message
      : String(overviewQuery.error);
  }, [overviewQuery.error]);

  const shouldPollProgress =
    overviewEnabled &&
    !baseOverviewError &&
    (overviewQuery.isFetching ||
      overviewQuery.isLoading ||
      pendingRequestKey === requestKey ||
      (!overviewHasValidData && !!overviewData));

  const progressQuery = useOverviewProgress(
    filePath,
    channels,
    maxPoints,
    shouldPollProgress,
  );

  const overviewError = useMemo(() => {
    if (timedOutRequestKey === requestKey) {
      return `Timed out loading summary overview after ${OVERVIEW_LOAD_TIMEOUT_MS / 1000}s`;
    }
    if (baseOverviewError) return baseOverviewError;

    // If backend returns an invalid/empty payload and progress polling also fails,
    // surface the polling failure instead of leaving UI in an ambiguous loading state.
    if (
      progressQuery.error &&
      !overviewHasValidData &&
      !overviewQuery.isFetching
    ) {
      return progressQuery.error instanceof Error
        ? progressQuery.error.message
        : String(progressQuery.error);
    }

    return null;
  }, [
    timedOutRequestKey,
    requestKey,
    baseOverviewError,
    overviewQuery.isFetching,
    progressQuery.error,
    overviewHasValidData,
  ]);

  useEffect(() => {
    if (!overviewEnabled || pendingRequestKey !== requestKey) return;

    if (overviewError || overviewHasValidData) {
      return deferStateUpdate(() => {
        setPendingRequestKey(null);
      });
    }
  }, [
    overviewEnabled,
    pendingRequestKey,
    requestKey,
    overviewError,
    overviewHasValidData,
  ]);

  // Refetch overview once backend signals generation completion.
  // This closes the "progress complete but stale/partial payload" race.
  useEffect(() => {
    const isComplete = progressQuery.data?.isComplete;
    const wasComplete = previousCompleteRef.current;

    if (isComplete && wasComplete === false) {
      void overviewQuery.refetch();
    }

    previousCompleteRef.current = isComplete;
  }, [progressQuery.data?.isComplete, overviewQuery]);

  const overviewLoading =
    overviewEnabled &&
    !overviewError &&
    (pendingRequestKey === requestKey ||
      overviewQuery.isLoading ||
      overviewQuery.isFetching ||
      !overviewHasValidData);

  const refetchOverview = () => {
    void overviewQuery.refetch();
  };

  return {
    overviewData,
    overviewLoading,
    overviewError,
    overviewProgress: progressQuery.data,
    refetchOverview,
  };
}
