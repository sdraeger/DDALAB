import { ipcMain, shell, app } from "electron";
import { DockerService } from "../services/docker-service";
import { logger } from "../utils/logger";
import fs from "fs/promises";
import path from "path";
import { getMainWindow } from "../utils/main-window";

export function registerMenuIpcHandlers(): void {
  // Handle menu actions from the menu service
  ipcMain.handle(
    "menu-export-configuration",
    async (event, exportPath: string) => {
      try {
        // Get current configuration state from the renderer
        const currentState = await event.sender.executeJavaScript(`
        window.electronAPI?.getConfigManagerState?.() || {}
      `);

        const exportData = {
          version: app.getVersion(),
          timestamp: new Date().toISOString(),
          configuration: currentState,
          metadata: {
            platform: process.platform,
            nodeVersion: process.version,
            electronVersion: process.versions.electron,
          },
        };

        await fs.writeFile(
          exportPath,
          JSON.stringify(exportData, null, 2),
          "utf8"
        );
        logger.info(`Configuration exported to: ${exportPath}`);
        return {
          success: true,
          message: "Configuration exported successfully",
        };
      } catch (error: any) {
        logger.error("Error exporting configuration:", error);
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle(
    "menu-import-configuration",
    async (event, importPath: string) => {
      try {
        const fileContent = await fs.readFile(importPath, "utf8");
        const importData = JSON.parse(fileContent);

        if (!importData.configuration) {
          throw new Error("Invalid configuration file format");
        }

        // Send the imported configuration to the renderer
        event.sender.send("configuration-imported", importData.configuration);
        logger.info(`Configuration imported from: ${importPath}`);
        return {
          success: true,
          message: "Configuration imported successfully",
        };
      } catch (error: any) {
        logger.error("Error importing configuration:", error);
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle("menu-reset-all-settings", async (event) => {
    try {
      // Clear application data
      const userDataPath = app.getPath("userData");
      const configPath = path.join(userDataPath, "config.json");

      try {
        await fs.unlink(configPath);
      } catch (error) {
        // File might not exist, which is fine
      }

      // Notify renderer to reset state
      event.sender.send("settings-reset");
      logger.info("All settings reset successfully");
      return { success: true, message: "All settings reset successfully" };
    } catch (error: any) {
      logger.error("Error resetting settings:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("menu-validate-current-setup", async (event) => {
    try {
      // Get current setup path from renderer
      const currentState = await event.sender.executeJavaScript(`
        window.electronAPI?.getConfigManagerState?.() || {}
      `);

      if (!currentState.setupPath && !currentState.dataLocation) {
        return { success: false, error: "No setup path configured" };
      }

      const setupPath = currentState.setupPath || currentState.dataLocation;

      // Validate Docker setup if it's a Docker configuration
      const result = await validateSetupDirectory(setupPath);
      logger.info(`Setup validation result for ${setupPath}:`, result);

      return result;
    } catch (error: any) {
      logger.error("Error validating setup:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("menu-action", async (event, action: string) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      logger.warn(`Main window not available for menu action: ${action}`);
      return;
    }

    logger.info(`Menu action received: ${action}`);

    switch (action) {
      case "start-ddalab":
        const startResult = await DockerService.startMonolithicDocker();
        if (startResult) {
          logger.info("DDALAB services started from menu.");
        } else {
          logger.error("Failed to start DDALAB services from menu.");
        }
        break;
      case "stop-ddalab":
        const stopResult = await DockerService.stopMonolithicDocker(false);
        if (stopResult) {
          logger.info("DDALAB services stopped from menu.");
        } else {
          logger.error("Failed to stop DDALAB services from menu.");
        }
        break;
      case "restart-ddalab":
        const stopThenRestartResult =
          await DockerService.stopMonolithicDocker(false);
        if (stopThenRestartResult) {
          setTimeout(async () => {
            const restartResult = await DockerService.startMonolithicDocker();
            if (restartResult) {
              logger.info("DDALAB services restarted from menu.");
            } else {
              logger.error("Failed to restart DDALAB services from menu.");
            }
          }, 2000);
        } else {
          logger.error("Failed to stop DDALAB services for restart from menu.");
        }
        break;
      case "reset-ddalab-volumes":
        const resetResult = await DockerService.stopMonolithicDocker(true); // Delete volumes
        if (resetResult) {
          logger.info("DDALAB services stopped and volumes deleted from menu.");
        } else {
          logger.error("Failed to stop DDALAB and delete volumes from menu.");
        }
        break;
      // Add other menu actions here
      default:
        logger.warn(`Unknown menu action: ${action}`);
    }
  });

  ipcMain.handle("menu-check-docker-status", async (event) => {
    try {
      const isRunning = await DockerService.getIsDockerRunning();
      const status = await DockerService.getDockerStatus();

      event.sender.send("docker-status-update", {
        type: "info",
        message: `Docker services are ${isRunning ? "running" : "stopped"}`,
      });

      return {
        success: true,
        running: isRunning,
        status: status,
        message: `Services are ${isRunning ? "running" : "stopped"}`,
      };
    } catch (error: any) {
      logger.error("Error checking Docker status:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("menu-get-docker-logs", async () => {
    try {
      const logs = await DockerService.getDockerLogs();
      return { success: true, logs };
    } catch (error: any) {
      logger.error("Error getting Docker logs:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("menu-open-logs-directory", async () => {
    try {
      const userDataPath = app.getPath("userData");
      const logsPath = path.join(userDataPath, "logs");

      // Create logs directory if it doesn't exist
      try {
        await fs.mkdir(logsPath, { recursive: true });
      } catch (error) {
        // Directory might already exist
      }

      await shell.openPath(logsPath);
      return { success: true, path: logsPath };
    } catch (error: any) {
      logger.error("Error opening logs directory:", error);
      return { success: false, error: error.message };
    }
  });
}

async function validateSetupDirectory(
  setupPath: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    // Check if directory exists
    const stats = await fs.stat(setupPath);
    if (!stats.isDirectory()) {
      return { success: false, error: "Path is not a directory" };
    }

    // Check for common DDALAB files
    const requiredFiles = ["docker-compose.yml", ".env"];
    const missingFiles: string[] = [];

    for (const file of requiredFiles) {
      try {
        await fs.access(path.join(setupPath, file));
      } catch {
        missingFiles.push(file);
      }
    }

    if (missingFiles.length > 0) {
      return {
        success: false,
        error: `Missing required files: ${missingFiles.join(", ")}`,
      };
    }

    return {
      success: true,
      message: "Setup directory validation successful",
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
