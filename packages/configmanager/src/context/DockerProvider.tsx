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
      return;
    }

    const handleStatusUpdate = (statusUpdate: { type: string; message: string }) => {
      service.send({ type: "STATUS_UPDATE", statusUpdate });
    };

    const handleLogUpdate = (logUpdate: {
      type: string;
      message: string;
      logs?: string;
    }) => {
      service.send({ type: "LOG_UPDATE", logUpdate });
    };

    const handleStateUpdate = (stateUpdate: { type: string }) => {
      // Map the state update type to the expected docker machine event types
      if (stateUpdate.type === "SERVICES_READY" || stateUpdate.type === "SERVICES_UNHEALTHY") {
        service.send({ type: stateUpdate.type as "SERVICES_READY" | "SERVICES_UNHEALTHY" });
      }
    };

    // Set up event listeners using the preload API
    const removeStatusListener = window.electronAPI.onDockerStatusUpdate(handleStatusUpdate);
    const removeLogListener = window.electronAPI.onDockerLogUpdate(handleLogUpdate);

    return () => {
      removeStatusListener();
      removeLogListener();
    };
  }, [service]);

  return (
    <DockerContext.Provider value={service}>
      {children}
    </DockerContext.Provider>
  );
};
