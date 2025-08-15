import { useState, useEffect, useCallback } from 'react';
import { apiService } from '@/lib/api';

export interface SystemStatus {
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  uptime_seconds: number;
  db_status: string;
  network_status: string;
  status: string;
  timestamp: string;
}

interface UseSystemStatusOptions {
  refreshInterval?: number; // in milliseconds
  enabled?: boolean;
}

export function useSystemStatus(options: UseSystemStatusOptions = {}) {
  const { refreshInterval = 5000, enabled = true } = options;
  
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSystemStatus = useCallback(async () => {
    try {
      const response = await apiService.getSystemStatus();
      if (response.error) {
        setError(response.error);
        return;
      }
      if (response.data) {
        setSystemStatus(response.data);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch system status');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Initial fetch
    fetchSystemStatus();

    // Set up interval for periodic updates
    const interval = setInterval(fetchSystemStatus, refreshInterval);

    return () => clearInterval(interval);
  }, [fetchSystemStatus, refreshInterval, enabled]);

  return {
    systemStatus,
    isLoading,
    error,
    refetch: fetchSystemStatus,
  };
}

// Helper function to format uptime
export function formatUptime(uptimeSeconds: number): string {
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

// Helper function to get status color
export function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'online':
    case 'active':
    case 'connected':
      return 'bg-green-500';
    case 'warning':
      return 'bg-yellow-500';
    case 'error':
    case 'offline':
    case 'disconnected':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
}