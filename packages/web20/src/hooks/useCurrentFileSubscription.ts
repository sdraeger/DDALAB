import { useEffect, useState, useCallback } from "react";
import { useAppSelector } from "@/store/hooks";
import { selectCurrentFilePath, selectCurrentPlotState } from "@/store/slices/plotSlice";
import type { PlotState } from "@/store/slices/plotSlice";

// Type for file selection event
export interface FileSelectionEvent {
  filePath: string | null;
  metadata?: any;
  edfData?: any;
  selectedChannels?: string[];
}

// Type for subscription callback
export type FileSelectionCallback = (event: FileSelectionEvent) => void;

// Global event manager for file selection
export class FileSelectionEventManager {
  private callbacks: Set<FileSelectionCallback> = new Set();
  private lastEvent: FileSelectionEvent | null = null;

  subscribe(callback: FileSelectionCallback) {
    this.callbacks.add(callback);
    // Immediately notify with the last known event if available
    if (this.lastEvent) {
      callback(this.lastEvent);
    }
    return () => this.unsubscribe(callback);
  }

  unsubscribe(callback: FileSelectionCallback) {
    this.callbacks.delete(callback);
  }

  notify(event: FileSelectionEvent) {
    this.lastEvent = event;
    this.callbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error("Error in file selection callback:", error);
      }
    });
  }
}

// Global instance
export const eventManager = new FileSelectionEventManager();

// Hook for widgets to subscribe to file selection events
export function useCurrentFileSubscription(callback: FileSelectionCallback) {
  useEffect(() => {
    return eventManager.subscribe(callback);
  }, [callback]);
}

// Hook for components to get current file info and dispatch events
export function useCurrentFileInfo() {
  const currentFilePath = useAppSelector((state: any) => 
    state.plots ? selectCurrentFilePath({ plots: state.plots }) : null
  );
  const currentPlotState = useAppSelector((state: any) => 
    state.plots ? selectCurrentPlotState({ plots: state.plots }) : undefined
  );

  const dispatchFileSelection = useCallback(
    (event: Omit<FileSelectionEvent, "filePath"> = {}) => {
      if (currentFilePath) {
        eventManager.notify({
          filePath: currentFilePath,
          metadata: currentPlotState?.metadata,
          edfData: currentPlotState?.edfData,
          selectedChannels: currentPlotState?.selectedChannels,
          ...event,
        });
      }
    },
    [currentFilePath, currentPlotState]
  );

  return {
    currentFilePath,
    currentPlotState,
    dispatchFileSelection,
  };
}

// Initialize event manager with Redux store updates
export function useFileSelectionInitializer() {
  const currentFilePath = useAppSelector((state: any) => 
    state.plots ? selectCurrentFilePath({ plots: state.plots }) : null
  );
  const currentPlotState = useAppSelector((state: any) => 
    state.plots ? selectCurrentPlotState({ plots: state.plots }) : undefined
  );

  useEffect(() => {
    if (currentFilePath) {
      eventManager.notify({
        filePath: currentFilePath,
        metadata: currentPlotState?.metadata,
        edfData: currentPlotState?.edfData,
        selectedChannels: currentPlotState?.selectedChannels,
      });
    }
  }, [currentFilePath, currentPlotState]);
}