import { useEffect } from "react";
import { useAppSelector } from "@/store/hooks";
import { selectCurrentFilePath, selectCurrentPlotState } from "@/store/slices/plotSlice";
import type { PlotState } from "@/store/slices/plotSlice";
import { eventManager } from "./useCurrentFileSubscription";

// Hook to initialize file selection events from Redux store updates
export function useFileSelectionEvents(enabled: boolean = true) {
  const currentFilePath = useAppSelector((state: any) => 
    state.plots ? selectCurrentFilePath({ plots: state.plots }) : null
  );
  const currentPlotState = useAppSelector((state: any) => 
    state.plots ? selectCurrentPlotState({ plots: state.plots }) : undefined
  );

  useEffect(() => {
    // Only notify if enabled and when Redux state changes
    if (enabled && currentFilePath) {
      eventManager.notify({
        filePath: currentFilePath,
        metadata: currentPlotState?.metadata,
        edfData: currentPlotState?.edfData,
        selectedChannels: currentPlotState?.selectedChannels,
      });
    }
  }, [enabled, currentFilePath, currentPlotState]);
}