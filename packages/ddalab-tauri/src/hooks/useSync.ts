import { invoke } from "@tauri-apps/api/core";
import { useEffect, useCallback } from "react";
import { useAppStore } from "@/store/appStore";
import type {
  AccessPolicy,
  SharedResultInfo,
  SyncConnectionConfig,
  DiscoveredBroker,
} from "@/types/sync";

export function useSync() {
  const { sync, updateSyncStatus } = useAppStore();
  const { isConnected, isLoading, error } = sync;

  const checkConnection = useCallback(async () => {
    try {
      const connected = await invoke<boolean>("sync_is_connected");
      updateSyncStatus({ isConnected: connected });
    } catch (err) {
      updateSyncStatus({ isConnected: false });
      console.error("Failed to check sync connection:", err);
    }
  }, [updateSyncStatus]);

  useEffect(() => {
    // Initial check
    checkConnection();

    // Periodic check every 5 seconds to keep status up to date
    const interval = setInterval(checkConnection, 5000);

    return () => clearInterval(interval);
  }, [checkConnection]);

  const connect = useCallback(
    async (config: SyncConnectionConfig) => {
      updateSyncStatus({ isLoading: true, error: null });
      try {
        await invoke("sync_connect", {
          brokerUrl: config.broker_url,
          userId: config.user_id,
          localEndpoint: config.local_endpoint,
        });
        // Immediately update connection state
        updateSyncStatus({ isConnected: true, isLoading: false });

        // Double-check connection status from backend (async, doesn't block UI)
        setTimeout(() => checkConnection(), 100);
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
    [checkConnection, updateSyncStatus],
  );

  const disconnect = useCallback(async () => {
    updateSyncStatus({ isLoading: true, error: null });
    try {
      await invoke("sync_disconnect");
      // Immediately update connection state
      updateSyncStatus({ isConnected: false, isLoading: false });

      // Double-check connection status from backend (async, doesn't block UI)
      setTimeout(() => checkConnection(), 100);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateSyncStatus({ error: message, isLoading: false });
      throw err;
    }
  }, [checkConnection, updateSyncStatus]);

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
