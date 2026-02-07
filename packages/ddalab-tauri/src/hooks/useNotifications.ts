import { useState, useEffect, useCallback } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { TauriService, Notification } from "@/services/tauriService";

interface UseNotificationsResult {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
}

export function useNotifications(limit?: number): UseNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!TauriService.isTauri()) return;

    try {
      setIsLoading(true);
      const [notifs, count] = await Promise.all([
        TauriService.listNotifications(limit),
        TauriService.getUnreadCount(),
      ]);
      setNotifications(notifs);
      setUnreadCount(count);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load notifications",
      );
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    if (!TauriService.isTauri()) return;

    // Initial load
    loadNotifications();

    // Subscribe to notification changes (event-based, no polling)
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen("notifications-changed", () => {
        loadNotifications();
      });
    };

    setupListener().catch((err) =>
      console.error("[Notifications] Failed to setup listener:", err),
    );

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [loadNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    await TauriService.markNotificationRead(id);
    // State update will come from the event
  }, []);

  const markAllAsRead = useCallback(async () => {
    await TauriService.markAllNotificationsRead();
    // State update will come from the event
  }, []);

  const deleteNotification = useCallback(async (id: string) => {
    await TauriService.deleteNotification(id);
    // State update will come from the event
  }, []);

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    refresh: loadNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  };
}

// Lightweight hook for just the unread count (for badges, etc.)
export function useUnreadNotificationCount(): number {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!TauriService.isTauri()) return;

    // Initial load
    TauriService.getUnreadCount()
      .then(setUnreadCount)
      .catch(() => {});

    // Subscribe to notification changes (event-based, no polling)
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen("notifications-changed", async () => {
        try {
          const count = await TauriService.getUnreadCount();
          setUnreadCount(count);
        } catch {
          // Ignore errors
        }
      });
    };

    setupListener().catch((err) =>
      console.error(
        "[Notifications] Failed to setup unread count listener:",
        err,
      ),
    );

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  return unreadCount;
}
