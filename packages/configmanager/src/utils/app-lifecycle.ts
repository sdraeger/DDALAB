import { app, BrowserWindow } from "electron";
import { createWindow } from "./window-manager";
import { DockerService } from "../services/docker-service";
import { SystemTrayService } from "../services/system-tray-service";
import { AutoUpdateService } from "../services/auto-update-service";
import { EnvironmentIsolationService } from "../services/environment-isolation";
import { logger } from "./logger";

export function initializeAppLifecycle(): void {
  app.whenReady().then(async () => {
    // Initialize environment isolation FIRST
    const envConfig = await EnvironmentIsolationService.initialize();
    logger.info(`App started in ${envConfig.mode} mode`);

    const mainWindow = createWindow();

    // Initialize system tray
    SystemTrayService.initialize(mainWindow);

    // Initialize auto-update service
    AutoUpdateService.initialize(mainWindow);

    // Check Docker installation on startup
    await checkDockerInstallationOnStartup();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    DockerService.stopLogStream();
    SystemTrayService.destroy();
  });
}

async function checkDockerInstallationOnStartup(): Promise<void> {
  try {
    logger.info("Checking Docker installation on startup...");
    const status = await DockerService.checkDockerInstallation();

    if (!status.dockerInstalled || !status.dockerComposeInstalled) {
      logger.warn("Docker installation check failed on startup:", status);

      // Send notification to renderer process
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send("docker-installation-check", {
          status,
          instructions: DockerService.getDockerInstallationInstructions(),
        });
      }
    } else {
      logger.info("Docker installation verified on startup:", status);
    }
  } catch (error: any) {
    logger.error("Error checking Docker installation on startup:", error);
  }
}
