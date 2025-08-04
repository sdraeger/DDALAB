import { app, BrowserWindow } from "electron";
import { createWindow } from "./window-manager";
import { DockerService } from "../services/docker-service";
import { SystemTrayService } from "../services/system-tray-service";
import { AutoUpdateService } from "../services/auto-update-service";
import { MenuService } from "../services/menu-service";
import { EnvironmentIsolationService } from "../services/environment-isolation";
import { EnvironmentConfigService } from "../services/environment-config-service";
import { logger } from "./logger";

export function initializeAppLifecycle(): void {
  app.whenReady().then(async () => {
    // Initialize environment isolation FIRST
    const envConfig = await EnvironmentIsolationService.initialize();
    logger.info(`App started in ${envConfig.mode} mode`);

    // Initialize environment configuration
    const environment = EnvironmentConfigService.initialize();

    const mainWindow = createWindow();

    // Initialize application menu
    MenuService.initialize(mainWindow);

    // Initialize system tray
    SystemTrayService.initialize(mainWindow);

    // Initialize auto-update service with environment-specific configuration
    AutoUpdateService.initialize(mainWindow);
    AutoUpdateService.configureUpdateChannel(environment);

    // Check Docker installation on startup
    await checkDockerInstallationOnStartup();

    app.on("activate", () => {
      // On macOS, show the window when clicking the dock icon
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else {
        // If window exists but is hidden, show it
        const existingWindow = BrowserWindow.getAllWindows()[0];
        if (existingWindow && !existingWindow.isVisible()) {
          existingWindow.show();
          existingWindow.focus();
        }
      }
    });
  });

  app.on("window-all-closed", () => {
    // Don't quit the app when all windows are closed
    // The app will continue running in the system tray/dock
    // Users can quit via the tray context menu or Cmd+Q on macOS
  });

  app.on("before-quit", (event) => {
    // Check if quit confirmation has been shown already
    if (!SystemTrayService.getIsQuitting()) {
      // Prevent default quit and show confirmation dialog
      event.preventDefault();

      // Send quit request to renderer to show confirmation modal
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send("quit-request");
      } else {
        // If no window, allow quit to proceed
        DockerService.stopLogStream();
        SystemTrayService.destroy();
      }
    } else {
      // Quit confirmation already handled, proceed with cleanup
      DockerService.stopLogStream();
      SystemTrayService.destroy();
    }
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
