"use client";

import { useCallback, useEffect, useRef } from "react";
import logger from "../lib/utils/logger";

interface DataSyncOptions {
  channel?: string;
  onError?: (error: Error) => void;
}

export function useWidgetDataSync(
  widgetId: string,
  isPopout: boolean = false,
  options: DataSyncOptions = {}
) {
  const { channel = `widget-sync-${widgetId}` } = options;
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const dataListenersRef = useRef<Map<string, (data: any) => void>>(new Map());

  // Initialize BroadcastChannel
  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
      logger.warn(`[useWidgetDataSync] BroadcastChannel not supported`);
      return;
    }

    try {
      broadcastChannelRef.current = new BroadcastChannel(channel);

      broadcastChannelRef.current.onmessage = (event) => {
        const { type, data } = event.data;
        const listener = dataListenersRef.current.get(type);
        if (listener) {
          listener(data);
        }
      };

      return () => {
        broadcastChannelRef.current?.close();
        broadcastChannelRef.current = null;
      };
    } catch (error) {
      logger.error(
        `[useWidgetDataSync] Failed to initialize BroadcastChannel:`,
        error
      );
    }
  }, [channel]);

  // Register a data listener
  const registerDataListener = useCallback(
    (type: string, callback: (data: any) => void) => {
      dataListenersRef.current.set(type, callback);

      return () => {
        dataListenersRef.current.delete(type);
      };
    },
    []
  );

  // Unregister a data listener
  const unregisterDataListener = useCallback((type: string) => {
    dataListenersRef.current.delete(type);
  }, []);

  // Sync data between windows
  const syncData = useCallback((type: string, data: any) => {
    if (!broadcastChannelRef.current) {
      logger.warn(
        `[useWidgetDataSync] BroadcastChannel not available for sync`
      );
      return;
    }

    try {
      // For plot data, send the complete data to ensure chart rendering
      if (type === "plots") {
        // If data is null, request data from main window
        if (!data) {
          logger.info(
            `[useWidgetDataSync] Requesting plot data from main window`
          );
          broadcastChannelRef.current.postMessage({
            type: "REQUEST_PLOTS_DATA",
          });
          return;
        }

        const plotData = Object.entries(data || {}).reduce(
          (acc: any, [filePath, plotState]: [string, any]) => {
            if (!plotState) {
              logger.warn(
                `[useWidgetDataSync] Plot state is null for ${filePath}`
              );
              return acc;
            }

            logger.info(
              `[useWidgetDataSync] Processing plot data for ${filePath}:`,
              {
                hasEdfData: !!plotState.edfData,
                hasMetadata: !!plotState.metadata,
                selectedChannels: plotState.selectedChannels?.length || 0,
              }
            );

            acc[filePath] = {
              ...plotState,
              // Include essential data for chart rendering
              edfData: plotState.edfData
                ? {
                    ...plotState.edfData,
                    data: plotState.edfData.data, // Explicitly include the data array
                    channels: plotState.edfData.channels,
                    sampleRate: plotState.edfData.sampleRate,
                    duration: plotState.edfData.duration,
                    samplesPerChannel: plotState.edfData.samplesPerChannel,
                    startTime: plotState.edfData.startTime,
                    annotations: plotState.edfData.annotations,
                  }
                : null,
              metadata: plotState.metadata,
              selectedChannels: plotState.selectedChannels,
              timeWindow: plotState.timeWindow,
              absoluteTimeWindow: plotState.absoluteTimeWindow,
              zoomLevel: plotState.zoomLevel,
              annotations: plotState.annotations,
              chunkStart: plotState.chunkStart,
              currentChunkNumber: plotState.currentChunkNumber,
              chunkSizeSeconds: plotState.chunkSizeSeconds,
            };
            return acc;
          },
          {}
        );

        logger.info(`[useWidgetDataSync] Sending plot data:`, {
          type,
          plotKeys: Object.keys(plotData),
          hasData: !!plotData && Object.keys(plotData).length > 0,
        });

        broadcastChannelRef.current.postMessage({ type, data: plotData });
      } else {
        broadcastChannelRef.current.postMessage({ type, data });
      }
    } catch (error) {
      logger.error(`[useWidgetDataSync] Failed to sync data:`, {
        type,
        error,
      });
    }
  }, []);

  return {
    registerDataListener,
    unregisterDataListener,
    syncData,
  };
}
