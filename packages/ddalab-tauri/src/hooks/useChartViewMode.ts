import { useState, useCallback } from "react";

export type ChartViewMode = "chart" | "table";

export interface ChartViewModeState {
  mode: ChartViewMode;
  setMode: (mode: ChartViewMode) => void;
  toggleMode: () => void;
  isChartMode: boolean;
  isTableMode: boolean;
}

export function useChartViewMode(
  initialMode: ChartViewMode = "chart",
): ChartViewModeState {
  const [mode, setMode] = useState<ChartViewMode>(initialMode);

  const toggleMode = useCallback(() => {
    setMode((prev) => (prev === "chart" ? "table" : "chart"));
  }, []);

  return {
    mode,
    setMode,
    toggleMode,
    isChartMode: mode === "chart",
    isTableMode: mode === "table",
  };
}
