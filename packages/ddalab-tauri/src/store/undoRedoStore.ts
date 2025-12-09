import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export interface UndoableAction {
  id: string;
  type: string;
  label: string;
  timestamp: number;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
  // Optional: data for display
  details?: string;
}

interface UndoRedoState {
  // Undo stack (most recent first)
  undoStack: UndoableAction[];
  // Redo stack (most recent first)
  redoStack: UndoableAction[];
  // Max history size
  maxHistorySize: number;
  // Is currently performing undo/redo
  isUndoing: boolean;
  isRedoing: boolean;

  // Actions
  pushAction: (action: Omit<UndoableAction, "id" | "timestamp">) => void;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
  getUndoLabel: () => string | null;
  getRedoLabel: () => string | null;
}

let actionIdCounter = 0;

export const useUndoRedoStore = create<UndoRedoState>()(
  immer((set, get) => ({
    undoStack: [],
    redoStack: [],
    maxHistorySize: 50,
    isUndoing: false,
    isRedoing: false,

    pushAction: (action) => {
      set((state) => {
        const newAction: UndoableAction = {
          ...action,
          id: `action-${++actionIdCounter}`,
          timestamp: Date.now(),
        };

        state.undoStack.unshift(newAction);

        // Trim to max size
        if (state.undoStack.length > state.maxHistorySize) {
          state.undoStack = state.undoStack.slice(0, state.maxHistorySize);
        }

        // Clear redo stack when new action is pushed
        state.redoStack = [];
      });
    },

    undo: async () => {
      const { undoStack, isUndoing, isRedoing } = get();

      if (undoStack.length === 0 || isUndoing || isRedoing) {
        return false;
      }

      set((state) => {
        state.isUndoing = true;
      });

      try {
        const action = undoStack[0];
        await action.undo();

        set((state) => {
          const [undone] = state.undoStack.splice(0, 1);
          state.redoStack.unshift(undone);
          state.isUndoing = false;
        });

        return true;
      } catch {
        set((state) => {
          state.isUndoing = false;
        });
        return false;
      }
    },

    redo: async () => {
      const { redoStack, isUndoing, isRedoing } = get();

      if (redoStack.length === 0 || isUndoing || isRedoing) {
        return false;
      }

      set((state) => {
        state.isRedoing = true;
      });

      try {
        const action = redoStack[0];
        await action.redo();

        set((state) => {
          const [redone] = state.redoStack.splice(0, 1);
          state.undoStack.unshift(redone);
          state.isRedoing = false;
        });

        return true;
      } catch {
        set((state) => {
          state.isRedoing = false;
        });
        return false;
      }
    },

    canUndo: () => {
      const { undoStack, isUndoing, isRedoing } = get();
      return undoStack.length > 0 && !isUndoing && !isRedoing;
    },

    canRedo: () => {
      const { redoStack, isUndoing, isRedoing } = get();
      return redoStack.length > 0 && !isUndoing && !isRedoing;
    },

    clearHistory: () => {
      set((state) => {
        state.undoStack = [];
        state.redoStack = [];
      });
    },

    getUndoLabel: () => {
      const { undoStack } = get();
      return undoStack.length > 0 ? undoStack[0].label : null;
    },

    getRedoLabel: () => {
      const { redoStack } = get();
      return redoStack.length > 0 ? redoStack[0].label : null;
    },
  })),
);

// Hook to create undoable actions easily
export function useUndoable() {
  const pushAction = useUndoRedoStore((s) => s.pushAction);

  return {
    /**
     * Execute an action and make it undoable
     */
    execute: async <T>(
      label: string,
      doAction: () => T | Promise<T>,
      undoAction: () => void | Promise<void>,
      type: string = "generic",
    ): Promise<T> => {
      const result = await doAction();

      pushAction({
        type,
        label,
        undo: undoAction,
        redo: doAction as () => void | Promise<void>,
      });

      return result;
    },

    /**
     * Push an undoable action without executing it
     * (for cases where the action has already been performed)
     */
    push: pushAction,
  };
}
