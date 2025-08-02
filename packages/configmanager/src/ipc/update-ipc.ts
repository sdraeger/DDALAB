import { ipcMain } from "electron";
import { logger } from "../utils/logger";
import { AutoUpdateService } from "../services/auto-update-service";

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
}
