import { ipcMain } from "electron";
import { logger } from "../utils/logger";
import { AutoUpdateService } from "../services/auto-update-service";
import { EnvironmentConfigService } from "../services/environment-config-service";

export function registerUpdateIpcHandlers(): void {
  ipcMain.handle("check-for-updates", async (): Promise<void> => {
    try {
      logger.info("Manual update check requested");
      await AutoUpdateService.forceCheckForUpdates();
    } catch (error: any) {
      logger.error("Error checking for updates:", error);
    }
  });

  ipcMain.handle("get-update-info", () => {
    return AutoUpdateService.getUpdateInfo();
  });

  ipcMain.handle("is-update-available", () => {
    return AutoUpdateService.isUpdateAvailable();
  });

  ipcMain.handle("get-current-version", () => {
    return AutoUpdateService.getCurrentVersion();
  });

  ipcMain.handle("get-environment", () => {
    return EnvironmentConfigService.getCurrentEnvironment();
  });

  ipcMain.handle("get-system-info", () => {
    return {
      platform: process.platform,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      arch: process.arch
    };
  });

  ipcMain.handle("download-update", async (): Promise<void> => {
    try {
      logger.info("Manual update download requested");
      // This will trigger the download process
      await AutoUpdateService.forceCheckForUpdates();
    } catch (error: any) {
      logger.error("Error downloading update:", error);
    }
  });

  ipcMain.handle("test-update-check", async (): Promise<void> => {
    try {
      logger.info("Test update check requested");
      await AutoUpdateService.testUpdateCheck();
    } catch (error: any) {
      logger.error("Error testing update check:", error);
    }
  });
}
