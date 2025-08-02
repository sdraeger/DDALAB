import { ipcMain } from "electron";
import { logger } from "../utils/logger";
import { DockerService } from "../services/docker-service";
import { SetupService } from "../services/setup-service";
import { getMainWindow } from "../utils/main-window";
import { exec } from "child_process";

export function registerDockerIpcHandlers() {
  logger.info("Registering Docker IPC handlers...");

  ipcMain.handle("start-docker-compose", async (): Promise<boolean> => {
    logger.info('IPC event "start-docker-compose" received.');
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      logger.error("Cannot start Docker Compose: mainWindow not set.");
      return false;
    }

    const state = await SetupService.getConfigManagerState();
    if (!state.setupComplete || !state.setupPath) {
      logger.error(
        "Cannot start Docker Compose: setup not complete or path missing."
      );
      mainWindow.webContents.send("docker-status-update", {
        type: "error",
        message: "Setup is not complete. Please run setup first.",
      });
      return false;
    }

    return DockerService.startDockerCompose(state);
  });

  ipcMain.handle(
    "stop-docker-compose",
    async (event, deleteVolumes?: boolean): Promise<boolean> => {
      logger.info('IPC event "stop-docker-compose" received.', {
        deleteVolumes,
      });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        logger.error("Cannot stop Docker Compose: mainWindow not set.");
        return false;
      }

      const state = await SetupService.getConfigManagerState();
      if (!state.setupComplete || !state.setupPath) {
        logger.error(
          "Cannot stop Docker Compose: setup not complete or path missing."
        );
        mainWindow.webContents.send("docker-status-update", {
          type: "error",
          message: "Setup is not complete. Cannot stop services.",
        });
        return false;
      }

      return DockerService.stopDockerCompose(state, deleteVolumes);
    }
  );

  ipcMain.handle("get-docker-status", async (): Promise<boolean> => {
    logger.info('IPC event "get-docker-status" received.');
    try {
      const state = await SetupService.getConfigManagerState();
      if (!state.setupComplete || !state.setupPath) {
        logger.info("Docker status: Setup not complete or no path");
        return false;
      }

      const projectName = await DockerService.getDockerProjectName();
      const command = `docker compose -p ${projectName} ps --services --filter status=running`;
      logger.info(`Checking Docker status with command: ${command}`);

      const { stdout } = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          exec(
            command,
            {
              cwd: state.setupPath!,
              env: DockerService.getDockerEnvironment(),
            },
            (error, stdout, stderr) => {
              if (error) {
                logger.info(
                  `Docker status check error (likely no containers): ${error.message}`
                );
                resolve({ stdout: "", stderr });
              } else {
                resolve({ stdout, stderr });
              }
            }
          );
        }
      );

      const isRunning = stdout.trim().length > 0;
      logger.info(
        `Docker status result: ${isRunning} (output: "${stdout.trim()}")`
      );

      // If containers are running but log stream isn't active, start it
      if (isRunning && !DockerService.getIsDockerRunning()) {
        logger.info("Starting log stream for detected running containers");
        DockerService.streamDockerLogs(state);
        // Update the internal running state
        (DockerService as any).isDockerRunning = true;
      }

      return isRunning;
    } catch (error) {
      logger.error(`Error checking Docker status:`, error);
      return false;
    }
  });

  ipcMain.handle("start-docker-log-stream", async (): Promise<boolean> => {
    logger.info('IPC event "start-docker-log-stream" received.');
    const state = await SetupService.getConfigManagerState();
    if (!state.setupComplete || !state.setupPath) {
      logger.error("Cannot start log stream: setup not complete or path missing.");
      return false;
    }

    try {
      DockerService.streamDockerLogs(state);
      logger.info("Docker log stream started successfully");
      return true;
    } catch (error: any) {
      logger.error("Failed to start Docker log stream:", error.message);
      return false;
    }
  });

  ipcMain.handle("stop-docker-log-stream", async (): Promise<void> => {
    logger.info('IPC event "stop-docker-log-stream" received.');
    DockerService.stopLogStream();
  });

  ipcMain.handle("fetch-current-docker-logs", async (): Promise<string> => {
    logger.info('IPC event "fetch-current-docker-logs" received.');
    const state = await SetupService.getConfigManagerState();

    // Also start streaming logs if containers are running
    const isRunning = await DockerService.getIsDockerRunning();
    if (isRunning && state.setupComplete && state.setupPath) {
      logger.info("Starting log stream for running containers");
      DockerService.streamDockerLogs(state);
    }

    return DockerService.fetchCurrentDockerLogs(state);
  });

  ipcMain.handle("get-is-docker-running", async (): Promise<boolean> => {
    logger.info('IPC event "get-is-docker-running" received.');
    return DockerService.getIsDockerRunning();
  });

  ipcMain.on("ddalab-services-ready", () => {
    logger.info("All services are healthy");
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send("docker-state-update", {
        type: "SERVICES_READY",
      });
    }
  });

  ipcMain.on("docker-services-unhealthy", () => {
    logger.warn("Some services are unhealthy");
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send("docker-state-update", {
        type: "SERVICES_UNHEALTHY",
      });
    }
  });

  logger.info("Docker IPC handlers registered");
}
