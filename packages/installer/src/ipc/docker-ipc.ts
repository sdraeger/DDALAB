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

    const state = await SetupService.getInstallerState();
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

      const state = await SetupService.getInstallerState();
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
      const state = await SetupService.getInstallerState();
      if (!state.setupComplete || !state.setupPath) {
        logger.info("Docker status: Setup not complete or no path");
        return false;
      }

      const projectName = await DockerService.getDockerProjectName();
      const command = `docker-compose -f docker-compose.yml -f docker-compose.volumes.yml ps --services --filter status=running`;
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
      return isRunning;
    } catch (error) {
      logger.error(`Error checking Docker status:`, error);
      return false;
    }
  });

  ipcMain.handle("stop-docker-log-stream", async (): Promise<void> => {
    logger.info('IPC event "stop-docker-log-stream" received.');
    DockerService.stopLogStream();
  });

  ipcMain.handle("fetch-current-docker-logs", async (): Promise<string> => {
    logger.info('IPC event "fetch-current-docker-logs" received.');
    const state = await SetupService.getInstallerState();
    return DockerService.fetchCurrentDockerLogs(state);
  });

  ipcMain.handle("get-is-docker-running", async (): Promise<boolean> => {
    logger.info('IPC event "get-is-docker-running" received.');
    return DockerService.getIsDockerRunning();
  });

  logger.info("Docker IPC handlers registered");
}
