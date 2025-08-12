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
    const state = await DockerService.getConfigManagerState(); // Assuming this method exists and returns state
    return DockerService.startMonolithicDocker(state);
  });

  ipcMain.handle(
    "stop-monolithic-docker",
    async (event, deleteVolumes: boolean) => {
      logger.info(
        `IPC: stop-monolithic-docker (deleteVolumes: ${deleteVolumes})`
      );
      const state = await DockerService.getConfigManagerState();
      return DockerService.stopMonolithicDocker(state, deleteVolumes);
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

  ipcMain.handle("check-docker-installation", async () => {
    logger.info("IPC: check-docker-installation");
    return DockerService.isDockerInstalled();
  });

  ipcMain.handle("get-docker-installation-instructions", async () => {
    logger.info("IPC: get-docker-installation-instructions");
    return DockerService.getInstallationInstructions();
  });
}
