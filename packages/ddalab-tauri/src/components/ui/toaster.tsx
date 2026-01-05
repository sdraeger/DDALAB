"use client";

import { useEffect, useState } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
}

let toastIdCounter = 0;
const toastListeners: Set<(toast: Toast) => void> = new Set();

// Default durations by type - errors/warnings need more reading time
const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 4000, // Quick acknowledgment
  info: 4000, // Quick acknowledgment
  warning: 6000, // Users need time to understand
  error: 8000, // Users need time to read and possibly take action
};

export function toast(
  type: ToastType,
  title: string,
  description?: string,
  duration?: number,
) {
  const id = `toast-${++toastIdCounter}`;
  const effectiveDuration = duration ?? DEFAULT_DURATIONS[type];
  const newToast: Toast = {
    id,
    type,
    title,
    description,
    duration: effectiveDuration,
  };

  toastListeners.forEach((listener) => listener(newToast));
}

// Convenience methods
toast.success = (title: string, description?: string, duration?: number) =>
  toast("success", title, description, duration);
toast.error = (title: string, description?: string, duration?: number) =>
  toast("error", title, description, duration);
toast.info = (title: string, description?: string, duration?: number) =>
  toast("info", title, description, duration);
toast.warning = (title: string, description?: string, duration?: number) =>
  toast("warning", title, description, duration);

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const listener = (newToast: Toast) => {
      setToasts((prev) => [...prev, newToast]);

      // Auto-remove after duration
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== newToast.id));
      }, newToast.duration || 5000);
    };

    toastListeners.add(listener);
    return () => {
      toastListeners.delete(listener);
    };
  }, []);

  if (toasts.length === 0) return null;

  const getToastStyles = (type: ToastType) => {
    const baseStyles =
      "rounded-lg shadow-lg p-4 mb-3 min-w-[300px] max-w-[500px] animate-in slide-in-from-top-5";

    // Use theme-aware colors that work in both light and dark modes
    switch (type) {
      case "success":
        return `${baseStyles} bg-green-600 dark:bg-green-700 text-white border border-green-700 dark:border-green-600`;
      case "error":
        return `${baseStyles} bg-destructive text-destructive-foreground border border-destructive`;
      case "warning":
        return `${baseStyles} bg-yellow-500 dark:bg-yellow-600 text-white border border-yellow-600 dark:border-yellow-500`;
      case "info":
      default:
        return `${baseStyles} bg-blue-600 dark:bg-blue-700 text-white border border-blue-700 dark:border-blue-600`;
    }
  };

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col items-end pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={getToastStyles(t.type) + " pointer-events-auto"}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="font-semibold">{t.title}</div>
              {t.description && (
                <div className="text-sm opacity-90 mt-1">{t.description}</div>
              )}
            </div>
            <button
              onClick={() =>
                setToasts((prev) => prev.filter((toast) => toast.id !== t.id))
              }
              className="text-white/80 hover:text-white transition-colors"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
