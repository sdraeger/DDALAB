import { useState, useEffect, useCallback } from 'react';
import type { ElectronAPI } from '../utils/electron';

export interface SystemStatus {
  dockerInstalled: boolean;
  dockerRunning: boolean;
  ddalabRunning: boolean;
  ddalabHealthy: boolean;
  lastChecked: Date;
  error?: string;
}

export interface DetailedServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'error';
  description: string;
  canStart: boolean;
  canStop: boolean;
}

/**
 * Centralized system status management hook
 * This is the single source of truth for all DDALAB status checks
 */
export const useSystemStatus = (electronAPI?: ElectronAPI) => {
  const [status, setStatus] = useState<SystemStatus>({
    dockerInstalled: false,
    dockerRunning: false,
    ddalabRunning: false,
    ddalabHealthy: false,
    lastChecked: new Date(),
  });

  const [isChecking, setIsChecking] = useState(false);

  const checkStatus = useCallback(async (): Promise<SystemStatus> => {
    if (!electronAPI) {
      const errorStatus: SystemStatus = {
        dockerInstalled: false,
        dockerRunning: false,
        ddalabRunning: false,
        ddalabHealthy: false,
        lastChecked: new Date(),
        error: 'ElectronAPI not available',
      };
      setStatus(errorStatus);
      return errorStatus;
    }

    setIsChecking(true);

    try {
      // Check Docker installation
      const dockerInstallStatus = await electronAPI.checkDockerInstallation();
      
      // Check if Docker daemon is running
      const dockerDaemonRunning = await electronAPI.getIsDockerRunning();
      
      // Check if DDALAB containers are actually running and healthy
      const ddalabServicesHealthy = await electronAPI.checkDdalabServicesHealth();

      const newStatus: SystemStatus = {
        dockerInstalled: dockerInstallStatus.dockerInstalled,
        dockerRunning: dockerDaemonRunning,
        ddalabRunning: ddalabServicesHealthy,
        ddalabHealthy: ddalabServicesHealthy,
        lastChecked: new Date(),
        error: dockerInstallStatus.error,
      };

      setStatus(newStatus);
      return newStatus;
    } catch (error: any) {
      const errorStatus: SystemStatus = {
        dockerInstalled: false,
        dockerRunning: false,
        ddalabRunning: false,
        ddalabHealthy: false,
        lastChecked: new Date(),
        error: error.message || 'Failed to check system status',
      };
      setStatus(errorStatus);
      return errorStatus;
    } finally {
      setIsChecking(false);
    }
  }, [electronAPI]);

  // Generate detailed service status for UI components
  const getDetailedServiceStatus = useCallback((): DetailedServiceStatus[] => {
    const dockerEngineStatus: DetailedServiceStatus = {
      name: 'Docker Engine',
      status: status.dockerInstalled 
        ? (status.dockerRunning ? 'running' : 'stopped') 
        : 'error',
      description: status.dockerInstalled 
        ? (status.dockerRunning ? 'Docker daemon is running' : 'Docker daemon is not running')
        : 'Docker is not installed',
      canStart: false,
      canStop: false,
    };

    const ddalabServicesStatus: DetailedServiceStatus = {
      name: 'DDALAB Services',
      status: status.dockerRunning 
        ? (status.ddalabRunning ? 'running' : 'stopped') 
        : 'error',
      description: status.dockerRunning 
        ? (status.ddalabRunning ? 'All DDALAB containers are running' : 'DDALAB containers are stopped')
        : 'Docker daemon is not running',
      canStart: status.dockerRunning && !status.ddalabRunning,
      canStop: status.dockerRunning && status.ddalabRunning,
    };

    return [dockerEngineStatus, ddalabServicesStatus];
  }, [status]);

  // Auto-refresh status periodically
  useEffect(() => {
    if (!electronAPI) return;

    // Initial check
    checkStatus();

    // Set up periodic checking
    const interval = setInterval(checkStatus, 15000); // Check every 15 seconds
    
    return () => clearInterval(interval);
  }, [electronAPI, checkStatus]);

  return {
    status,
    isChecking,
    checkStatus,
    getDetailedServiceStatus,
    
    // Convenient boolean getters
    isDockerInstalled: status.dockerInstalled,
    isDockerRunning: status.dockerRunning,
    isDdalabRunning: status.ddalabRunning,
    isDdalabHealthy: status.ddalabHealthy,
    isSystemHealthy: status.dockerInstalled && status.dockerRunning && status.ddalabHealthy,
    
    // Error state
    hasError: !!status.error,
    error: status.error,
    lastChecked: status.lastChecked,
  };
};