import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect, useCallback } from 'react';
import type { AccessPolicy, SharedResultInfo, SyncConnectionConfig, DiscoveredBroker } from '@/types/sync';

export function useSync() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkConnection = useCallback(async () => {
    try {
      const connected = await invoke<boolean>('sync_is_connected');
      setIsConnected(connected);
    } catch (err) {
      setIsConnected(false);
      console.error('Failed to check sync connection:', err);
    }
  }, []);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  const connect = useCallback(async (config: SyncConnectionConfig) => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke('sync_connect', {
        brokerUrl: config.broker_url,
        userId: config.user_id,
        localEndpoint: config.local_endpoint,
      });
      setIsConnected(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setIsConnected(false);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke('sync_disconnect');
      setIsConnected(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const shareResult = useCallback(async (
    resultId: string,
    title: string,
    description: string | null,
    accessPolicy: AccessPolicy
  ): Promise<string> => {
    setError(null);
    try {
      const shareLink = await invoke<string>('sync_share_result', {
        resultId,
        title,
        description,
        accessPolicy,
      });
      return shareLink;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    }
  }, []);

  const accessShare = useCallback(async (token: string): Promise<SharedResultInfo> => {
    setError(null);
    try {
      const info = await invoke<SharedResultInfo>('sync_access_share', { token });
      return info;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    }
  }, []);

  const revokeShare = useCallback(async (token: string): Promise<void> => {
    setError(null);
    try {
      await invoke('sync_revoke_share', { token });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    }
  }, []);

  const discoverBrokers = useCallback(async (timeoutSecs: number = 5): Promise<DiscoveredBroker[]> => {
    setError(null);
    try {
      const brokers = await invoke<DiscoveredBroker[]>('sync_discover_brokers', { timeoutSecs });
      return brokers;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    }
  }, []);

  const verifyPassword = useCallback(async (password: string, authHash: string): Promise<boolean> => {
    try {
      return await invoke<boolean>('sync_verify_password', { password, authHash });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return false;
    }
  }, []);

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
