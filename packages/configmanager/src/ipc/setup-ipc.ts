import { ipcMain } from "electron";
import fs from "fs/promises";
import { logger } from "../utils/logger";
import { getMainWindow } from "../utils/main-window";
import {
  SetupService,
  SetupResult,
  UserConfiguration,
} from "../services/setup-service";

export function registerSetupIpcHandlers() {
  logger.info("Registering setup IPC handlers...");

  ipcMain.handle("get-configmanager-state", async (event): Promise<any> => {
    logger.info('IPC event "get-configmanager-state" received.');
    return await SetupService.getConfigManagerState();
  });

  ipcMain.handle(
    "run-initial-setup",
    async (
      event,
      dataLocation: string,
      cloneLocation: string,
      userConfig: UserConfiguration
    ): Promise<SetupResult> => {
      logger.info('IPC event "run-initial-setup" received.', {
        dataLocation,
        cloneLocation,
        userConfig,
      });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        logger.error("Cannot run initial setup: mainWindow not set.");
        return { success: false, message: "Main window not available." };
      }

      mainWindow.webContents.send("setup-progress", {
        message: "Starting DDALAB setup...",
      });

      try {
        // Clean the clone location directory
        await fs.rm(cloneLocation, { recursive: true, force: true });
        logger.info(
          `Successfully removed existing directory: ${cloneLocation}`
        );

        // Use the enhanced setup method
        const result = await SetupService.setupDDALAB(
          cloneLocation,
          userConfig
        );

        if (result.success) {
          await SetupService.saveConfigManagerState(
            dataLocation,
            cloneLocation
          );
          mainWindow.webContents.send("setup-progress", {
            message:
              "Setup complete! Application will now prepare the main interface.",
            type: "success",
          });
          mainWindow.webContents.send(
            "setup-finished",
            await SetupService.getConfigManagerState()
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
      userConfig: UserConfiguration
    ): Promise<SetupResult> => {
      logger.info('IPC event "clone-repository-to-directory" received.', {
        targetDirectory,
        userConfig,
      });

      // Use the enhanced setup method
      const result = await SetupService.setupDDALAB(
        targetDirectory,
        userConfig
      );

      if (result.success) {
        // For manual setup clone, both data and clone location are the same directory
        await SetupService.saveConfigManagerState(
          targetDirectory,
          targetDirectory
        );
        getMainWindow()?.webContents.send("setup-progress", {
          message: "DDALAB setup complete!",
          type: "success",
        });
      }
      return result;
    }
  );

  ipcMain.handle(
    "save-configmanager-state",
    async (
      event,
      setupPathOrDataLocation: string | null,
      cloneLocation?: string
    ): Promise<void> => {
      logger.info('IPC event "save-configmanager-state" received.', {
        setupPathOrDataLocation,
        cloneLocation,
      });
      await SetupService.saveConfigManagerState(
        setupPathOrDataLocation,
        cloneLocation
      );
    }
  );

  logger.info("Setup IPC handlers registered");
}
