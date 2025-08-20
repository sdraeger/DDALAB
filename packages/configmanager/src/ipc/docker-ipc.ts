import { ipcMain } from "electron";
import { DockerService } from "../services/docker-service";
import { logger } from "../utils/logger";

export function registerDockerIpcHandlers() {
  ipcMain.handle("get-docker-status", async () => {
    logger.info("IPC: get-docker-status");
    return DockerService.getDockerStatus();
  });

  ipcMain.handle("get-is-docker-running", async () => {
    logger.info("IPC: get-is-docker-running");
    return DockerService.isDockerDaemonRunning();
  });

  ipcMain.handle("start-monolithic-docker", async (event) => {
    logger.info("IPC: start-monolithic-docker");
    try {
      const state = await DockerService.getConfigManagerState();
      logger.info("Retrieved state for start:", JSON.stringify(state));
      if (!state || !state.setupPath) {
        logger.error("Invalid state - missing setupPath:", state);
        return false;
      }
      return DockerService.startMonolithicDocker(state);
    } catch (error: any) {
      logger.error("Error in start-monolithic-docker handler:", error);
      return false;
    }
  });

  ipcMain.handle(
    "stop-monolithic-docker",
    async (event, deleteVolumes: boolean) => {
      logger.info(
        `IPC: stop-monolithic-docker (deleteVolumes: ${deleteVolumes})`
      );
      try {
        const state = await DockerService.getConfigManagerState();
        logger.info("Retrieved state for stop:", JSON.stringify(state));
        if (!state || !state.setupPath) {
          logger.error("Invalid state - missing setupPath:", state);
          return false;
        }
        return DockerService.stopMonolithicDocker(state, deleteVolumes);
      } catch (error: any) {
        logger.error("Error in stop-monolithic-docker handler:", error);
        return false;
      }
    }
  );

  ipcMain.handle("fetch-current-docker-logs", async () => {
    logger.info("IPC: fetch-current-docker-logs");
    // This might require a more complex implementation if logs are not always streamed.
    // For now, return an empty string or placeholder.
    return "Logs not available via direct fetch, use stream.";
  });

  ipcMain.handle("start-docker-log-stream", async () => {
    logger.info("IPC: start-docker-log-stream");
    const state = await DockerService.getConfigManagerState();
    return DockerService.startDockerLogStream(state);
  });

  ipcMain.handle("remove-docker-log-stream", () => {
    logger.info("IPC: remove-docker-log-stream");
    DockerService.removeDockerLogStream();
  });

  ipcMain.handle("check-ddalab-services-health", async () => {
    logger.info("IPC: check-ddalab-services-health");
    try {
      return await DockerService.checkAllServicesHealth();
    } catch (error: any) {
      logger.error("Error checking DDALAB services health:", error);
      return false;
    }
  });

  // Note: check-docker-installation is handled in docker-check-ipc.ts
  // Note: get-docker-installation-instructions is handled in docker-check-ipc.ts
}
