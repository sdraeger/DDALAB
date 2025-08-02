import { useContext } from "react";
import { useSelector } from "@xstate/react";
import { DockerContext } from "../context/DockerProvider";
import type { StateFrom } from "xstate";
import { dockerMachine } from "../machines/docker-machine";

type DockerState = StateFrom<typeof dockerMachine>;

export const useDockerState = () => {
  const service = useContext(DockerContext);

  // Use useSelector to properly subscribe to state changes
  const state = useSelector(service, (state: DockerState) => state);
  const context = useSelector(service, (state: DockerState) => state.context);

  return {
    // State values
    dockerStatus: context.status,
    dockerLogs: context.logs,
    isTraefikHealthy: context.isTraefikHealthy,
    lastError: context.lastError,
    currentState: state.value,

    // Action dispatchers
    startDocker: () => {
      service.send("START_DOCKER");
    },

    stopDocker: () => {
      service.send("STOP_DOCKER");
    },

    fetchLogs: () => {
      service.send("FETCH_LOGS");
    },

    dockerStarted: () => {
      service.send("DOCKER_STARTED");
    },

    dockerStopped: () => {
      service.send("DOCKER_STOPPED");
    },

    servicesReady: () => {
      service.send("SERVICES_READY");
    },

    statusUpdate: (statusUpdate: { type: string; message: string }) => {
      service.send({ type: "STATUS_UPDATE", statusUpdate });
    },

    logUpdate: (logUpdate: {
      type: string;
      message: string;
      logs?: string;
    }) => {
      service.send({ type: "LOG_UPDATE", logUpdate });
    },

    error: (error: string) => {
      service.send({ type: "ERROR", error });
    },

    // Helper methods for adding logs
    addActionLog: (action: string) => {
      const log = `[ACTION] ${action} (${new Date().toLocaleTimeString()})`;
      service.send({
        type: "LOG_UPDATE",
        logUpdate: { type: "info", message: action },
      });
    },

    addErrorLog: (error: string) => {
      service.send({ type: "ERROR", error });
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
