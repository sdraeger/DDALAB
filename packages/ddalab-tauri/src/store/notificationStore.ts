import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";

export type NotificationType = "info" | "success" | "warning" | "error";
export type NotificationCategory =
  | "system"
  | "analysis"
  | "file"
  | "sync"
  | "update";

export interface Notification {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message?: string;
  timestamp: number;
  read: boolean;
  persistent: boolean; // Whether it stays until dismissed
  actionLabel?: string;
  actionCallback?: string; // Serializable action identifier
  metadata?: Record<string, unknown>;
}

interface NotificationFilters {
  types: NotificationType[];
  categories: NotificationCategory[];
  unreadOnly: boolean;
}

interface NotificationState {
  notifications: Notification[];
  maxNotifications: number;
  filters: NotificationFilters;

  // Actions
  addNotification: (
    notification: Omit<Notification, "id" | "timestamp" | "read">,
  ) => string;
  removeNotification: (id: string) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  clearRead: () => void;

  // Filtering
  setFilters: (filters: Partial<NotificationFilters>) => void;
  resetFilters: () => void;
  getFilteredNotifications: () => Notification[];
  getUnreadCount: () => number;

  // Quick notification helpers
  notify: {
    info: (
      title: string,
      message?: string,
      category?: NotificationCategory,
    ) => string;
    success: (
      title: string,
      message?: string,
      category?: NotificationCategory,
    ) => string;
    warning: (
      title: string,
      message?: string,
      category?: NotificationCategory,
    ) => string;
    error: (
      title: string,
      message?: string,
      category?: NotificationCategory,
    ) => string;
  };
}

const DEFAULT_FILTERS: NotificationFilters = {
  types: ["info", "success", "warning", "error"],
  categories: ["system", "analysis", "file", "sync", "update"],
  unreadOnly: false,
};

function generateId(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    immer((set, get) => ({
      notifications: [],
      maxNotifications: 100,
      filters: { ...DEFAULT_FILTERS },

      addNotification: (notification) => {
        const id = generateId();
        set((state) => {
          state.notifications.unshift({
            ...notification,
            id,
            timestamp: Date.now(),
            read: false,
          });

          // Trim to max
          if (state.notifications.length > state.maxNotifications) {
            // Keep persistent notifications, remove oldest non-persistent
            const persistent = state.notifications.filter((n) => n.persistent);
            const nonPersistent = state.notifications
              .filter((n) => !n.persistent)
              .slice(0, state.maxNotifications - persistent.length);
            state.notifications = [...persistent, ...nonPersistent].sort(
              (a, b) => b.timestamp - a.timestamp,
            );
          }
        });
        return id;
      },

      removeNotification: (id) => {
        set((state) => {
          state.notifications = state.notifications.filter((n) => n.id !== id);
        });
      },

      markAsRead: (id) => {
        set((state) => {
          const notification = state.notifications.find((n) => n.id === id);
          if (notification) {
            notification.read = true;
          }
        });
      },

      markAllAsRead: () => {
        set((state) => {
          state.notifications.forEach((n) => {
            n.read = true;
          });
        });
      },

      clearAll: () => {
        set((state) => {
          state.notifications = [];
        });
      },

      clearRead: () => {
        set((state) => {
          state.notifications = state.notifications.filter(
            (n) => !n.read || n.persistent,
          );
        });
      },

      setFilters: (filters) => {
        set((state) => {
          Object.assign(state.filters, filters);
        });
      },

      resetFilters: () => {
        set((state) => {
          state.filters = { ...DEFAULT_FILTERS };
        });
      },

      getFilteredNotifications: () => {
        const { notifications, filters } = get();
        return notifications.filter((n) => {
          if (filters.unreadOnly && n.read) return false;
          if (!filters.types.includes(n.type)) return false;
          if (!filters.categories.includes(n.category)) return false;
          return true;
        });
      },

      getUnreadCount: () => {
        return get().notifications.filter((n) => !n.read).length;
      },

      notify: {
        info: (title, message, category = "system") => {
          return get().addNotification({
            type: "info",
            category,
            title,
            message,
            persistent: false,
          });
        },
        success: (title, message, category = "system") => {
          return get().addNotification({
            type: "success",
            category,
            title,
            message,
            persistent: false,
          });
        },
        warning: (title, message, category = "system") => {
          return get().addNotification({
            type: "warning",
            category,
            title,
            message,
            persistent: false,
          });
        },
        error: (title, message, category = "system") => {
          return get().addNotification({
            type: "error",
            category,
            title,
            message,
            persistent: true, // Errors persist by default
          });
        },
      },
    })),
    {
      name: "ddalab-notifications",
      partialize: (state) => ({
        notifications: state.notifications,
        filters: state.filters,
      }),
    },
  ),
);

// Helper hook for notification actions
export function useNotificationActions() {
  const notify = useNotificationStore((s) => s.notify);
  const addNotification = useNotificationStore((s) => s.addNotification);

  return {
    notify,
    addNotification,
    // Pre-built notifications for common scenarios
    notifyAnalysisComplete: (name: string) =>
      notify.success(
        `Analysis Complete`,
        `"${name}" analysis finished successfully`,
        "analysis",
      ),
    notifyAnalysisError: (name: string, error: string) =>
      notify.error(`Analysis Failed`, `"${name}": ${error}`, "analysis"),
    notifyFileLoaded: (fileName: string) =>
      notify.success(
        `File Loaded`,
        `Successfully loaded "${fileName}"`,
        "file",
      ),
    notifyFileError: (fileName: string, error: string) =>
      notify.error(
        `File Error`,
        `Failed to load "${fileName}": ${error}`,
        "file",
      ),
    notifySyncComplete: () =>
      notify.success(`Sync Complete`, `All changes synchronized`, "sync"),
    notifySyncError: (error: string) =>
      notify.error(`Sync Failed`, error, "sync"),
    notifyUpdateAvailable: (version: string) =>
      notify.info(
        `Update Available`,
        `Version ${version} is available`,
        "update",
      ),
  };
}
