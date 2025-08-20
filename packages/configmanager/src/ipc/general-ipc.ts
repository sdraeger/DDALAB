import { ipcMain, shell, app } from "electron";
import { logger, createLogger } from "../utils/logger";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

export function setupGeneralIpc(): void {
  ipcMain.handle("open-external-url", async (_event, url: string) => {
    try {
      logger.info(`[general-ipc] Opening external URL: ${url}`);
      await shell.openExternal(url);
      return { success: true };
    } catch (error: any) {
      logger.error(`[general-ipc] Failed to open URL: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("get-home-directory", async () => {
    try {
      const homeDir = os.homedir();
      logger.info(`[general-ipc] Home directory: ${homeDir}`);
      return homeDir;
    } catch (error: any) {
      logger.error(`[general-ipc] Failed to get home directory: ${error.message}`);
      throw error;
    }
  });

  ipcMain.handle("get-platform", async () => {
    try {
      const platform = process.platform;
      logger.info(`[general-ipc] Platform: ${platform}`);
      return platform;
    } catch (error: any) {
      logger.error(`[general-ipc] Failed to get platform: ${error.message}`);
      throw error;
    }
  });

  ipcMain.handle("check-directory-exists", async (_event, dirPath: string) => {
    try {
      const exists = fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
      logger.info(`[general-ipc] Directory ${dirPath} exists: ${exists}`);
      return exists;
    } catch (error: any) {
      logger.error(`[general-ipc] Failed to check directory: ${error.message}`);
      return false;
    }
  });

  ipcMain.handle("check-file-exists", async (_event, filePath: string) => {
    try {
      const exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
      logger.info(`[general-ipc] File ${filePath} exists: ${exists}`);
      return exists;
    } catch (error: any) {
      logger.error(`[general-ipc] Failed to check file: ${error.message}`);
      return false;
    }
  });

  // Handle log messages from renderer process
  ipcMain.on("log:message", (_event, { level, context, message, args }) => {
    const rendererLogger = createLogger(context);
    switch (level.toLowerCase()) {
      case "debug":
        rendererLogger.debug(message, ...args);
        break;
      case "info":
        rendererLogger.info(message, ...args);
        break;
      case "warn":
        rendererLogger.warn(message, ...args);
        break;
      case "error":
        rendererLogger.error(message, ...args);
        break;
      case "fatal":
        rendererLogger.fatal(message, ...args);
        break;
      default:
        rendererLogger.info(message, ...args);
    }
  });
}