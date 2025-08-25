import React, { createContext, useContext, useEffect, ReactNode } from 'react';
import { healthCheckService, HealthStatus } from '../services/health-check-service';
import useHealthStatus from '../hooks/useHealthStatus';
import type { ElectronAPI } from '../utils/electron';
import { logger } from '../utils/logger-client';

interface HealthStatusContextType {
  healthStatus: HealthStatus | null;
  isRunning: boolean;
  isHealthy: boolean;
  criticalIssues: number;
  warnings: number;
  lastUpdate: string;
  startHealthCheck: () => void;
  stopHealthCheck: () => void;
  runImmediateCheck: () => Promise<HealthStatus>;
}

const HealthStatusContext = createContext<HealthStatusContextType | null>(null);

interface HealthStatusProviderProps {
  children: ReactNode;
  electronAPI?: ElectronAPI;
  userSelections?: any;
  isSetupComplete?: boolean;
  autoStart?: boolean;
  intervalMs?: number;
}

export const HealthStatusProvider: React.FC<HealthStatusProviderProps> = ({
  children,
  electronAPI,
  userSelections,
  isSetupComplete = false,
  autoStart = true,
  intervalMs = 30000,
}) => {
  const healthStatusHook = useHealthStatus({
    autoStart: autoStart, // Always start if autoStart is true, regardless of setup completion
    config: {
      enabled: true,
      intervalMs,
      timeoutMs: 10000,
      retryAttempts: 2,
      notifyOnFailure: true,
      autoRecover: false,
    },
    context: {
      electronAPI,
      userSelections,
      isSetupComplete,
    },
  });

  // Update context when dependencies change
  useEffect(() => {
    logger.info('Updating health check context', {
      hasElectronAPI: !!electronAPI,
      hasUserSelections: !!userSelections,
      isSetupComplete,
    });
    
    healthStatusHook.updateContext({
      electronAPI,
      userSelections,
      isSetupComplete,
    });
  }, [electronAPI, userSelections, isSetupComplete, healthStatusHook]);

  // Start health check if autoStart is enabled
  useEffect(() => {
    if (autoStart && !healthStatusHook.isRunning) {
      logger.info('Starting health checks');
      healthStatusHook.startHealthCheck();
    } else if (!autoStart && healthStatusHook.isRunning) {
      logger.info('AutoStart disabled, stopping health checks');
      healthStatusHook.stopHealthCheck();
    }
  }, [autoStart, healthStatusHook]);

  const contextValue: HealthStatusContextType = {
    healthStatus: healthStatusHook.healthStatus,
    isRunning: healthStatusHook.isRunning,
    isHealthy: healthStatusHook.isHealthy,
    criticalIssues: healthStatusHook.criticalIssues,
    warnings: healthStatusHook.warnings,
    lastUpdate: healthStatusHook.lastUpdate,
    startHealthCheck: healthStatusHook.startHealthCheck,
    stopHealthCheck: healthStatusHook.stopHealthCheck,
    runImmediateCheck: healthStatusHook.runImmediateCheck,
  };

  return (
    <HealthStatusContext.Provider value={contextValue}>
      {children}
    </HealthStatusContext.Provider>
  );
};

export const useHealthStatusContext = (): HealthStatusContextType => {
  const context = useContext(HealthStatusContext);
  if (!context) {
    throw new Error('useHealthStatusContext must be used within a HealthStatusProvider');
  }
  return context;
};

export default HealthStatusProvider;