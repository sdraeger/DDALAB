"use client";

import * as React from "react";
import type {
  ToastProps,
  ToastActionElement,
} from "shared/components/ui/toast";

const TOAST_LIMIT = 1;
const TOAST_REMOVE_DELAY = 1000000;

interface ToasterToast extends ToastProps {
  id: string;
  title?: string;
  description?: React.ReactNode;
  action?: ToastActionElement;
}

interface State {
  toasts: ToasterToast[];
}

type Action =
  | { type: "ADD_TOAST"; toast: ToasterToast }
  | { type: "UPDATE_TOAST"; toast: Partial<ToasterToast> }
  | { type: "DISMISS_TOAST"; toastId?: string }
  | { type: "REMOVE_TOAST"; toastId?: string };

const toastTimeouts = new Map<string, NodeJS.Timeout>();
let toastIdCounter = 0;

const generateId = () => String(++toastIdCounter);

const queueForRemoval = (toastId: string) => {
  if (toastTimeouts.has(toastId)) return;

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({ type: "REMOVE_TOAST", toastId });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      return { toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) };

    case "UPDATE_TOAST":
      return {
        toasts: state.toasts.map((toast) =>
          toast.id === action.toast.id ? { ...toast, ...action.toast } : toast
        ),
      };

    case "DISMISS_TOAST":
      if (action.toastId) {
        queueForRemoval(action.toastId);
      } else {
        state.toasts.forEach((toast) => queueForRemoval(toast.id));
      }
      return {
        toasts: state.toasts.map((toast) =>
          toast.id === action.toastId || !action.toastId
            ? { ...toast, open: false }
            : toast
        ),
      };

    case "REMOVE_TOAST":
      return {
        toasts: action.toastId
          ? state.toasts.filter((toast) => toast.id !== action.toastId)
          : [],
      };
  }
};

const listeners: Array<(state: State) => void> = [];
let memoryState: State = { toasts: [] };

const dispatch = (action: Action) => {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => listener(memoryState));
};

interface Toast extends Omit<ToasterToast, "id"> {}

const toast = ({ title, ...props }: Toast) => {
  const id = generateId();

  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id });
  const update = (props: Partial<ToasterToast>) =>
    dispatch({ type: "UPDATE_TOAST", toast: { ...props, id } });

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      title: title as string | undefined,
      open: true,
      onOpenChange: (open: boolean) => !open && dismiss(),
    },
  });

  return { id, dismiss, update };
};

const useToast = () => {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  };
};

export { useToast, toast };
