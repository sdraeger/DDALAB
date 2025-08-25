import { useEffect, useState, useCallback, useRef } from 'react';
import { healthCheckService, HealthStatus, HealthCheckConfig } from '../services/health-check-service';
import { logger } from '../utils/logger-client';
import type { ElectronAPI } from '../utils/electron';

interface UseHealthStatusOptions {
  autoStart?: boolean;
  config?: Partial<HealthCheckConfig>;
  context?: {
    electronAPI?: ElectronAPI;
    userSelections?: any;
    isSetupComplete?: boolean;
  };
}

interface UseHealthStatusReturn {
  healthStatus: HealthStatus | null;
  isRunning: boolean;
  lastUpdate: string;
  isHealthy: boolean;
  criticalIssues: number;
  warnings: number;
  startHealthCheck: () => void;
  stopHealthCheck: () => void;
  runImmediateCheck: () => Promise<HealthStatus>;
  updateConfig: (config: Partial<HealthCheckConfig>) => void;
  updateContext: (context: any) => void;
}

export const useHealthStatus = (options: UseHealthStatusOptions = {}): UseHealthStatusReturn => {
  const { 
    autoStart = true, 
    config = {},
    context = {}
  } = options;

  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(false);

  // Subscribe to health status changes
  useEffect(() => {
    const unsubscribe = healthCheckService.onHealthChange((status) => {
      setHealthStatus(status);
      setLastUpdate(new Date(status.timestamp).toLocaleTimeString());
    });

    unsubscribeRef.current = unsubscribe;

    // Get initial status if available
    const initialStatus = healthCheckService.getLastHealthStatus();
    if (initialStatus) {
      setHealthStatus(initialStatus);
      setLastUpdate(new Date(initialStatus.timestamp).toLocaleTimeString());
    }

    return () => {
      unsubscribe();
      unsubscribeRef.current = null;
    };
  }, []);

  // Auto-start health check service
  useEffect(() => {
    if (autoStart && !startedRef.current) {
      startHealthCheck();
      startedRef.current = true;
    }
    
    // Note: We don't automatically stop the service in cleanup
    // because multiple components might be using the same service
    // Only stop if autoStart becomes false
    if (!autoStart && startedRef.current) {
      stopHealthCheck();
      startedRef.current = false;
    }
  }, [autoStart]);

  // Update configuration when it changes
  useEffect(() => {
    if (Object.keys(config).length > 0) {
      healthCheckService.updateConfig(config);
    }
  }, [config]);

  // Update context when it changes
  useEffect(() => {
    if (Object.keys(context).length > 0) {
      healthCheckService.updateContext(context);
    }
  }, [context]);

  const startHealthCheck = useCallback(() => {
    try {
      logger.info('Starting health check from useHealthStatus hook');
      healthCheckService.start(context);
      setIsRunning(true);
    } catch (error) {
      logger.error('Failed to start health check service:', error);
    }
  }, [context]);

  const stopHealthCheck = useCallback(() => {
    try {
      logger.info('Stopping health check from useHealthStatus hook');
      healthCheckService.stop();
      setIsRunning(false);
    } catch (error) {
      logger.error('Failed to stop health check service:', error);
    }
  }, []);

  const runImmediateCheck = useCallback(async (): Promise<HealthStatus> => {
    try {
      logger.info('Running immediate health check');
      return await healthCheckService.runHealthCheck();
    } catch (error) {
      logger.error('Failed to run immediate health check:', error);
      throw error;
    }
  }, []);

  const updateConfig = useCallback((newConfig: Partial<HealthCheckConfig>) => {
    try {
      healthCheckService.updateConfig(newConfig);
    } catch (error) {
      logger.error('Failed to update health check config:', error);
    }
  }, []);

  const updateContext = useCallback((newContext: any) => {
    try {
      healthCheckService.updateContext(newContext);
    } catch (error) {
      logger.error('Failed to update health check context:', error);
    }
  }, []);

  // Computed values
  const isHealthy = healthStatus?.status === 'healthy' && (healthStatus?.overallHealth || 0) > 70;
  
  const criticalIssues = healthStatus?.checks?.filter(
    check => check.status === 'fail' && check.priority === 'critical'
  ).length || 0;

  const warnings = healthStatus?.checks?.filter(
    check => check.status === 'warn' || (check.status === 'fail' && check.priority !== 'critical')
  ).length || 0;

  return {
    healthStatus,
    isRunning,
    lastUpdate,
    isHealthy,
    criticalIssues,
    warnings,
    startHealthCheck,
    stopHealthCheck,
    runImmediateCheck,
    updateConfig,
    updateContext,
  };
};

export default useHealthStatus;