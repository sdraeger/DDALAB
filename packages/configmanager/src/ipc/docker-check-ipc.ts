import { ipcMain } from "electron";
import { logger } from "../utils/logger";
import {
  DockerService,
  DockerInstallationStatus,
} from "../services/docker-service";

export function registerDockerCheckIpcHandlers(): void {
  ipcMain.handle(
    "check-docker-installation",
    async (): Promise<DockerInstallationStatus> => {
      try {
        logger.info("Checking Docker installation...");
        const status = await DockerService.checkDockerInstallation();
        logger.info("Docker installation check completed:", status);
        return status;
      } catch (error: any) {
        logger.error("Error checking Docker installation:", error);
        return {
          dockerInstalled: false,
          dockerComposeInstalled: false,
          error: error.message,
        };
      }
    }
  );

  ipcMain.handle("get-docker-installation-instructions", (): string => {
    return DockerService.getDockerInstallationInstructions();
  });
}
