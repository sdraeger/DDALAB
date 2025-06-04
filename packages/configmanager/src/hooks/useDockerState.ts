import { useContext } from "react";
import { DockerContext } from "../context/DockerContext";

export const useDockerState = () => {
  const { state, send } = useContext(DockerContext);

  return {
    // State values
    dockerStatus: state.context.status,
    dockerLogs: state.context.logs,
    isTraefikHealthy: state.context.isTraefikHealthy,
    lastError: state.context.lastError,
    currentState: state.value,

    // Action dispatchers
    startDocker: () => {
      send("START_DOCKER");
    },

    stopDocker: () => {
      send("STOP_DOCKER");
    },

    fetchLogs: () => {
      send("FETCH_LOGS");
    },

    dockerStarted: () => {
      send("DOCKER_STARTED");
    },

    dockerStopped: () => {
      send("DOCKER_STOPPED");
    },

    servicesReady: () => {
      send("SERVICES_READY");
    },

    statusUpdate: (statusUpdate: { type: string; message: string }) => {
      send({ type: "STATUS_UPDATE", statusUpdate });
    },

    logUpdate: (logUpdate: {
      type: string;
      message: string;
      logs?: string;
    }) => {
      send({ type: "LOG_UPDATE", logUpdate });
    },

    error: (error: string) => {
      send({ type: "ERROR", error });
    },

    // Helper methods for adding logs
    addActionLog: (action: string) => {
      const log = `[ACTION] ${action} (${new Date().toLocaleTimeString()})`;
      send({
        type: "LOG_UPDATE",
        logUpdate: { type: "info", message: action },
      });
    },

    addErrorLog: (error: string) => {
      send({ type: "ERROR", error });
    },

    // State checkers
    isStarting: () => state.matches("starting"),
    isRunning: () =>
      state.matches("running") ||
      state.matches("runningCheckingHealth") ||
      state.matches("runningHealthy"),
    isStopping: () => state.matches("stopping"),
    isStopped: () => state.matches("stopped"),
    isError: () => state.matches("error"),
    isUnknown: () => state.matches("unknown"),

    // Button state helpers
    canStart: () =>
      state.matches("stopped") ||
      state.matches("unknown") ||
      state.matches("error"),
    canStop: () =>
      state.matches("running") ||
      state.matches("runningCheckingHealth") ||
      state.matches("runningHealthy"),
  };
};
