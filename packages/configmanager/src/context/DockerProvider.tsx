import React, { createContext, useEffect } from "react";
import { useInterpret } from "@xstate/react";
import { dockerMachine } from "../machines/docker-machine";
import { logger } from "../utils/logger-client";

export const DockerContext = createContext({} as any);

export const DockerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const service = useInterpret(dockerMachine);

  useEffect(() => {
    if (!window.electronAPI) {
      logger.error("electronAPI not available in window");
      logger.debug('DockerProvider window keys', Object.keys(window));
      return;
    }

    logger.debug('DockerProvider electronAPI available', { available: !!window.electronAPI, keys: Object.keys(window.electronAPI) });

    const handleStatusUpdate = (statusUpdate: { type: string; message: string }) => {
      logger.info("Received status update:", statusUpdate);
      service.send({ type: "STATUS_UPDATE", statusUpdate });
    };

    const handleLogUpdate = (logUpdate: {
      type: string;
      message: string;
      logs?: string;
    }) => {
      logger.info("Received log update:", logUpdate);
      service.send({ type: "LOG_UPDATE", logUpdate });
    };

    const handleStateUpdate = (stateUpdate: { type: string }) => {
      logger.info("Received state update:", stateUpdate);
      // Map the state update type to the expected docker machine event types
      if (stateUpdate.type === "SERVICES_READY" || 
          stateUpdate.type === "SERVICES_UNHEALTHY" ||
          stateUpdate.type === "DOCKER_STARTED" ||
          stateUpdate.type === "DOCKER_STOPPED") {
        service.send({ type: stateUpdate.type as "SERVICES_READY" | "SERVICES_UNHEALTHY" | "DOCKER_STARTED" | "DOCKER_STOPPED" });
      }
    };

    const handleDockerLogs = (log: { type: string; data: string }) => {
      logger.info("Received docker log event:", log);
      logger.debug('DockerProvider received docker log event', log);

      // Add more detailed logging
      logger.debug('DockerProvider state before LOG_UPDATE', { state: service.state.value, logType: log.type, dataLength: log.data?.length });

      service.send({
        type: "LOG_UPDATE",
        logUpdate: {
          type: log.type,
          message: log.data,
        }
      });

      logger.debug('DockerProvider state after LOG_UPDATE', service.state.value);
    };

    // Initial status check with delay to ensure IPC is ready
    const checkInitialDockerStatus = async () => {
      try {
        logger.info("Starting initial Docker status check...");
        // Add a small delay to ensure all IPC handlers are ready
        await new Promise(resolve => setTimeout(resolve, 500));

        if (!window.electronAPI) {
          logger.error("electronAPI not available for initial status check");
          return;
        }

        logger.info("Calling getDockerStatus...");
        const dockerStatus = await window.electronAPI.getDockerStatus();
        logger.info("Initial Docker status check result:", dockerStatus);

        // Check if Docker daemon is running
        if (dockerStatus && dockerStatus.isRunning) {
          logger.info("Docker daemon is running, checking DDALAB containers...");
          
          // Check if DDALAB services are actually healthy
          try {
            const servicesHealthy = await window.electronAPI.checkDdalabServicesHealth();
            logger.info("DDALAB services health check result:", servicesHealthy);
            
            if (servicesHealthy) {
              logger.info("DDALAB services are healthy, updating state");
              service.send({ type: "DOCKER_STARTED" });
              // Small delay to ensure state transition
              await new Promise(resolve => setTimeout(resolve, 100));
              service.send({ type: "SERVICES_READY" });
            } else {
              logger.info("Docker is running but DDALAB services are not healthy");
              // Leave in unknown state
            }
          } catch (error) {
            logger.error("Failed to check DDALAB services health:", error);
          }
        } else {
          logger.info("Docker daemon is not running");
          logger.debug('DockerProvider sending DOCKER_STOPPED', service.state.value);
          service.send({ type: "DOCKER_STOPPED" });
          logger.debug('DockerProvider after DOCKER_STOPPED', service.state.value);
        }
      } catch (error) {
        logger.error("Failed to check initial Docker status:", error);
        service.send({ type: "ERROR", error: "Failed to check Docker status" });
      }
    };

    // Set up event listeners using the preload API
    const removeStatusListener = window.electronAPI.onDockerStatusUpdate(handleStatusUpdate);
    const removeLogListener = window.electronAPI.onDockerLogUpdate(handleLogUpdate);
    const removeStateListener = window.electronAPI.onDockerStateUpdate(handleStateUpdate);
    const removeDockerLogsListener = window.electronAPI.onDockerLogs(handleDockerLogs);

    logger.debug('DockerProvider event listeners set up', {
      hasElectronAPI: !!window.electronAPI,
      hasOnDockerLogs: !!window.electronAPI?.onDockerLogs,
      hasOnDockerStatusUpdate: !!window.electronAPI?.onDockerStatusUpdate,
      hasOnDockerLogUpdate: !!window.electronAPI?.onDockerLogUpdate,
      hasOnDockerStateUpdate: !!window.electronAPI?.onDockerStateUpdate,
    });

    // Check initial status
    checkInitialDockerStatus();

    return () => {
      removeStatusListener();
      removeLogListener();
      removeStateListener();
      removeDockerLogsListener();
    };
  }, [service]);

  return (
    <DockerContext.Provider value={service}>
      {children}
    </DockerContext.Provider>
  );
};
