import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useCallback } from "react";
import { useAppStore } from "@/store/appStore";
import type {
  AccessPolicy,
  SharedResultInfo,
  SyncConnectionConfig,
  DiscoveredBroker,
} from "@/types/sync";

export function useSync() {
  const sync = useAppStore((state) => state.sync);
  const updateSyncStatus = useAppStore((state) => state.updateSyncStatus);
  const { isConnected, isLoading, error } = sync;

  const checkConnection = useCallback(async () => {
    try {
      const connected = await invoke<boolean>("sync_is_connected");
      updateSyncStatus({ isConnected: connected });
    } catch (err) {
      updateSyncStatus({ isConnected: false });
    }
  }, [updateSyncStatus]);

  useEffect(() => {
    // Initial check
    checkConnection();

    // Subscribe to sync connection status changes (event-based, no polling)
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    const setupListener = async () => {
      try {
        const unlistenFn = await listen<boolean>(
          "sync-connection-changed",
          (event) => {
            updateSyncStatus({ isConnected: event.payload });
          },
        );
        // Only assign if not cancelled during setup
        if (!cancelled) {
          unlisten = unlistenFn;
        } else {
          // Cleanup immediately if component unmounted during setup
          unlistenFn();
        }
      } catch (error) {
        console.error("[Sync] Failed to setup connection listener:", error);
      }
    };

    setupListener();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [checkConnection, updateSyncStatus]);

  const connect = useCallback(
    async (config: SyncConnectionConfig) => {
      updateSyncStatus({ isLoading: true, error: null });
      try {
        await invoke("sync_connect", {
          brokerUrl: config.broker_url,
          userId: config.user_id,
          localEndpoint: config.local_endpoint,
          password: config.password,
        });
        // State update will come from the sync-connection-changed event
        updateSyncStatus({ isLoading: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateSyncStatus({
          error: message,
          isConnected: false,
          isLoading: false,
        });
        throw err;
      }
    },
    [updateSyncStatus],
  );

  const disconnect = useCallback(async () => {
    updateSyncStatus({ isLoading: true, error: null });
    try {
      await invoke("sync_disconnect");
      // State update will come from the sync-connection-changed event
      updateSyncStatus({ isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateSyncStatus({ error: message, isLoading: false });
      throw err;
    }
  }, [updateSyncStatus]);

  const shareResult = useCallback(
    async (
      resultId: string,
      title: string,
      description: string | null,
      accessPolicy: AccessPolicy,
    ): Promise<string> => {
      updateSyncStatus({ error: null });
      try {
        const shareLink = await invoke<string>("sync_share_result", {
          resultId,
          title,
          description,
          accessPolicy,
        });
        return shareLink;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateSyncStatus({ error: message });
        throw err;
      }
    },
    [updateSyncStatus],
  );

  const accessShare = useCallback(
    async (token: string): Promise<SharedResultInfo> => {
      updateSyncStatus({ error: null });
      try {
        const info = await invoke<SharedResultInfo>("sync_access_share", {
          token,
        });
        return info;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateSyncStatus({ error: message });
        throw err;
      }
    },
    [updateSyncStatus],
  );

  const revokeShare = useCallback(
    async (token: string): Promise<void> => {
      updateSyncStatus({ error: null });
      try {
        await invoke("sync_revoke_share", { token });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateSyncStatus({ error: message });
        throw err;
      }
    },
    [updateSyncStatus],
  );

  const discoverBrokers = useCallback(
    async (timeoutSecs: number = 5): Promise<DiscoveredBroker[]> => {
      updateSyncStatus({ error: null });
      try {
        const brokers = await invoke<DiscoveredBroker[]>(
          "sync_discover_brokers",
          { timeoutSecs },
        );
        return brokers;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateSyncStatus({ error: message });
        throw err;
      }
    },
    [updateSyncStatus],
  );

  const verifyPassword = useCallback(
    async (password: string, authHash: string): Promise<boolean> => {
      try {
        return await invoke<boolean>("sync_verify_password", {
          password,
          authHash,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateSyncStatus({ error: message });
        return false;
      }
    },
    [updateSyncStatus],
  );

  return {
    isConnected,
    isLoading,
    error,
    connect,
    disconnect,
    shareResult,
    accessShare,
    revokeShare,
    checkConnection,
    discoverBrokers,
    verifyPassword,
  };
}
