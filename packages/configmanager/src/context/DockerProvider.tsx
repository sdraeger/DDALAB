import React, { createContext, useEffect } from "react";
import { useInterpret } from "@xstate/react";
import { dockerMachine } from "../machines/docker-machine";
import { logger } from "../utils/logger";

export const DockerContext = createContext({} as any);

export const DockerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const service = useInterpret(dockerMachine);

  useEffect(() => {
    if (!window.electronAPI) {
      logger.error("electronAPI not available in window");
      console.log("[DockerProvider] electronAPI not available in window");
      console.log("[DockerProvider] window keys:", Object.keys(window));
      return;
    }

    console.log("[DockerProvider] electronAPI is available:", !!window.electronAPI);
    console.log("[DockerProvider] electronAPI keys:", Object.keys(window.electronAPI));

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
      if (stateUpdate.type === "SERVICES_READY" || stateUpdate.type === "SERVICES_UNHEALTHY") {
        service.send({ type: stateUpdate.type as "SERVICES_READY" | "SERVICES_UNHEALTHY" });
      }
    };

    const handleDockerLogs = (log: { type: string; data: string }) => {
      logger.info("Received docker log event:", log);
      console.log("[DockerProvider] Received docker log event:", log);

      // Add more detailed logging
      console.log("[DockerProvider] Current state before LOG_UPDATE:", service.state.value);
      console.log("[DockerProvider] Log type:", log.type, "Data length:", log.data?.length);

      service.send({
        type: "LOG_UPDATE",
        logUpdate: {
          type: log.type,
          message: log.data,
        }
      });

      console.log("[DockerProvider] State after LOG_UPDATE:", service.state.value);
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
        const isRunning = await window.electronAPI.getDockerStatus();
        logger.info("Initial Docker status check result:", isRunning);

        if (isRunning) {
          logger.info("Sending DOCKER_STARTED event to state machine");
          console.log("[DockerProvider] Sending DOCKER_STARTED, current state:", service.state.value);
          service.send({ type: "DOCKER_STARTED" });
          console.log("[DockerProvider] After DOCKER_STARTED, new state:", service.state.value);

          // Start log streaming for already running containers
          try {
            logger.info("Starting log streaming for running containers...");
            await window.electronAPI.getDockerLogs();
            logger.info("Log streaming started successfully");
          } catch (error) {
            logger.warn("Failed to start log streaming:", error);
          }
        } else {
          logger.info("Sending DOCKER_STOPPED event to state machine");
          console.log("[DockerProvider] Sending DOCKER_STOPPED, current state:", service.state.value);
          service.send({ type: "DOCKER_STOPPED" });
          console.log("[DockerProvider] After DOCKER_STOPPED, new state:", service.state.value);
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

    console.log("[DockerProvider] Event listeners set up:", {
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
