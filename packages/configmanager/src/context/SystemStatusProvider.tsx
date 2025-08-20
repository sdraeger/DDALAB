import React, { createContext, useContext } from 'react';
import { useSystemStatus, SystemStatus, DetailedServiceStatus } from '../hooks/useSystemStatus';
import type { ElectronAPI } from '../utils/electron';

interface SystemStatusContextType {
  status: SystemStatus;
  isChecking: boolean;
  checkStatus: () => Promise<SystemStatus>;
  getDetailedServiceStatus: () => DetailedServiceStatus[];
  
  // Convenient boolean getters
  isDockerInstalled: boolean;
  isDockerRunning: boolean;
  isDdalabRunning: boolean;
  isDdalabHealthy: boolean;
  isSystemHealthy: boolean;
  
  // Error state
  hasError: boolean;
  error?: string;
  lastChecked: Date;
}

const SystemStatusContext = createContext<SystemStatusContextType | null>(null);

interface SystemStatusProviderProps {
  children: React.ReactNode;
  electronAPI?: ElectronAPI;
}

export const SystemStatusProvider: React.FC<SystemStatusProviderProps> = ({
  children,
  electronAPI,
}) => {
  const systemStatus = useSystemStatus(electronAPI);

  return (
    <SystemStatusContext.Provider value={systemStatus}>
      {children}
    </SystemStatusContext.Provider>
  );
};

export const useSystemStatusContext = (): SystemStatusContextType => {
  const context = useContext(SystemStatusContext);
  if (!context) {
    throw new Error('useSystemStatusContext must be used within a SystemStatusProvider');
  }
  return context;
};