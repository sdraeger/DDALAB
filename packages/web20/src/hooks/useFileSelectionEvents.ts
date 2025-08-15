import { useEffect } from "react";
import { useAppSelector } from "@/store/hooks";
import { selectCurrentFilePath, selectCurrentPlotState } from "@/store/slices/plotSlice";
import type { PlotState } from "@/store/slices/plotSlice";
import { eventManager } from "./useCurrentFileSubscription";

// Hook to initialize file selection events from Redux store updates
export function useFileSelectionEvents() {
  const currentFilePath = useAppSelector((state: any) => 
    state.plots ? selectCurrentFilePath({ plots: state.plots }) : null
  );
  const currentPlotState = useAppSelector((state: any) => 
    state.plots ? selectCurrentPlotState({ plots: state.plots }) : undefined
  );

  useEffect(() => {
    // When Redux state changes, notify all subscribers
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