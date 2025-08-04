import { ipcMain } from "electron";
import { logger } from "../utils/logger";
import { MinIOUpdateService } from "../services/minio-update-service";

export function registerMinIOUpdateIpcHandlers(): void {
  ipcMain.handle("check-minio-update", async () => {
    try {
      logger.info("MinIO update check requested");
      const updateInfo = await MinIOUpdateService.checkForMinIOUpdate();
      return updateInfo;
    } catch (error: any) {
      logger.error("Error checking for MinIO updates:", error);
      throw error;
    }
  });

  ipcMain.handle("update-minio", async () => {
    try {
      logger.info("MinIO update requested");
      const result = await MinIOUpdateService.updateMinIO();
      return result;
    } catch (error: any) {
      logger.error("Error updating MinIO:", error);
      return {
        success: false,
        message: `Update failed: ${error.message}`,
      };
    }
  });

  ipcMain.handle("get-minio-update-info", () => {
    return MinIOUpdateService.getUpdateInfo();
  });
}
