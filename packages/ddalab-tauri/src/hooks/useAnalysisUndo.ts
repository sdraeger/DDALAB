import { useCallback } from "react";
import { DDAParameters } from "@/components/analysis/AnalysisFormProvider";
import { useUndoable, useUndoRedoStore } from "@/store/undoRedoStore";

export interface AnalysisUndoActions {
  updateWithUndo: <K extends keyof DDAParameters>(
    key: K,
    newValue: DDAParameters[K],
    currentValue: DDAParameters[K],
    label?: string,
  ) => void;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  clearHistory: () => void;
}

export function useAnalysisUndo(
  onParameterChange: (key: keyof DDAParameters, value: any) => void,
): AnalysisUndoActions {
  const { push } = useUndoable();
  const undo = useUndoRedoStore((s) => s.undo);
  const redo = useUndoRedoStore((s) => s.redo);
  const canUndo = useUndoRedoStore((s) => s.canUndo());
  const canRedo = useUndoRedoStore((s) => s.canRedo());
  const undoLabel = useUndoRedoStore((s) => s.getUndoLabel());
  const redoLabel = useUndoRedoStore((s) => s.getRedoLabel());
  const clearHistory = useUndoRedoStore((s) => s.clearHistory);

  const updateWithUndo = useCallback(
    <K extends keyof DDAParameters>(
      key: K,
      newValue: DDAParameters[K],
      currentValue: DDAParameters[K],
      customLabel?: string,
    ) => {
      const label =
        customLabel ||
        `Change ${String(key)
          .replace(/([A-Z])/g, " $1")
          .toLowerCase()}`;

      push({
        type: "analysis-parameter",
        label,
        undo: () => {
          onParameterChange(key, currentValue);
        },
        redo: () => {
          onParameterChange(key, newValue);
        },
        details: `${String(key)}: ${JSON.stringify(currentValue)} → ${JSON.stringify(newValue)}`,
      });

      onParameterChange(key, newValue);
    },
    [push, onParameterChange],
  );

  return {
    updateWithUndo,
    undo,
    redo,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    clearHistory,
  };
}
