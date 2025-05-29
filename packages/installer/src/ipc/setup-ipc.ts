import { ipcMain } from "electron";
import path from "path";
import fs from "fs/promises";
import { logger } from "../utils/logger";
import {
  SetupService,
  InstallerState,
  SetupResult,
} from "../services/setup-service";
import { getMainWindow } from "../utils/main-window";

export function registerSetupIpcHandlers() {
  logger.info("Registering setup IPC handlers...");

  ipcMain.handle("get-installer-state", async (): Promise<InstallerState> => {
    logger.info('IPC event "get-installer-state" received.');
    return SetupService.getInstallerState();
  });

  ipcMain.handle(
    "mark-setup-complete",
    async (event, manualSetupDirectory?: string): Promise<SetupResult> => {
      logger.info('IPC event "mark-setup-complete" received.', {
        manualSetupDirectory,
      });
      if (manualSetupDirectory) {
        try {
          await fs.access(
            path.join(manualSetupDirectory, "docker-compose.yml")
          );
          logger.info(
            `docker-compose.yml found in manual path: ${manualSetupDirectory}`
          );
          await SetupService.saveInstallerState(
            manualSetupDirectory,
            manualSetupDirectory
          );
          return {
            success: true,
            message: "Setup complete!",
            setupPath: manualSetupDirectory || undefined,
          };
        } catch (error: any) {
          logger.error(
            `Validation Error: docker-compose.yml NOT found in manual path: ${manualSetupDirectory}.`,
            error
          );
          return {
            success: false,
            message: `Invalid manual setup directory: docker-compose.yml not found in ${manualSetupDirectory}.`,
            setupPath: undefined,
            needsClone: true,
            targetPath: manualSetupDirectory,
          };
        }
      } else {
        const currentState = await SetupService.getInstallerState();
        await SetupService.saveInstallerState(currentState.setupPath);
        return {
          success: true,
          message: "Setup complete!",
          setupPath: currentState.setupPath || undefined,
        };
      }
    }
  );

  ipcMain.handle(
    "run-initial-setup",
    async (
      event,
      dataLocation: string,
      cloneLocation: string
    ): Promise<SetupResult> => {
      logger.info('IPC event "run-initial-setup" received.', {
        dataLocation,
        cloneLocation,
      });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        logger.error("Cannot run initial setup: mainWindow not set.");
        return { success: false, message: "Main window not available." };
      }

      mainWindow.webContents.send("setup-progress", {
        message: "Starting setup...",
      });

      try {
        // Clean the clone location directory
        await fs.rm(cloneLocation, { recursive: true, force: true });
        logger.info(
          `Successfully removed existing directory: ${cloneLocation}`
        );

        const allowedDirsValue = `${dataLocation}:/app/data:rw`;
        const result = await SetupService.cloneRepository(
          cloneLocation,
          allowedDirsValue
        );
        if (result.success) {
          await SetupService.saveInstallerState(dataLocation, cloneLocation);
          mainWindow.webContents.send("setup-progress", {
            message:
              "Setup complete! Application will now prepare the main interface.",
            type: "success",
          });
          mainWindow.webContents.send(
            "setup-finished",
            await SetupService.getInstallerState()
          );
        }
        return result;
      } catch (error: any) {
        logger.error(`Error during initial setup:`, error);
        mainWindow.webContents.send("setup-progress", {
          message: `Setup failed: ${error.message}`,
          type: "error",
        });
        return { success: false, message: `Setup failed: ${error.message}` };
      }
    }
  );

  ipcMain.handle(
    "clone-repository-to-directory",
    async (
      event,
      targetDirectory: string,
      allowedDirsValue: string
    ): Promise<SetupResult> => {
      logger.info('IPC event "clone-repository-to-directory" received.', {
        targetDirectory,
        allowedDirsValue,
      });
      const result = await SetupService.cloneRepository(
        targetDirectory,
        allowedDirsValue
      );
      if (result.success) {
        // For manual setup clone, both data and clone location are the same directory
        await SetupService.saveInstallerState(targetDirectory, targetDirectory);
        getMainWindow()?.webContents.send("setup-progress", {
          message: "Repository setup complete!",
          type: "success",
        });
      }
      return result;
    }
  );

  logger.info("Setup IPC handlers registered");
}
