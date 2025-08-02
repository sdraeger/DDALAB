import { autoUpdater } from "electron-updater";
import { app, BrowserWindow, dialog } from "electron";
import { logger } from "../utils/logger";
import { getMainWindow } from "../utils/main-window";

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
  downloadUrl?: string;
}

export class AutoUpdateService {
  private static mainWindow: BrowserWindow | null = null;
  private static updateAvailable: boolean = false;
  private static updateInfo: UpdateInfo | null = null;

  static initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    this.setupAutoUpdater();
  }

  private static setupAutoUpdater(): void {
    // Configure auto-updater
    autoUpdater.autoDownload = false; // Don't auto-download, ask user first
    autoUpdater.autoInstallOnAppQuit = true;

    // Set up event listeners
    autoUpdater.on("checking-for-update", () => {
      logger.info("Checking for updates...");
      this.sendUpdateStatus("checking", "Checking for updates...");
    });

    autoUpdater.on("update-available", (info) => {
      logger.info("Update available:", info);
      this.updateAvailable = true;
      this.updateInfo = {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      };
      this.sendUpdateStatus("available", "Update available", info);
      this.promptForUpdate();
    });

    autoUpdater.on("update-not-available", (info) => {
      logger.info("Update not available:", info);
      this.sendUpdateStatus("not-available", "No updates available");
    });

    autoUpdater.on("error", (err) => {
      logger.error("Auto-updater error:", err);
      this.sendUpdateStatus("error", `Update error: ${err.message}`);
    });

    autoUpdater.on("download-progress", (progressObj) => {
      const logMessage = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
      logger.info(logMessage);
      this.sendUpdateStatus(
        "downloading",
        `Downloading update: ${Math.round(progressObj.percent)}%`
      );
    });

    autoUpdater.on("update-downloaded", (info) => {
      logger.info("Update downloaded:", info);
      this.sendUpdateStatus(
        "downloaded",
        "Update downloaded and ready to install"
      );
      this.promptForInstall();
    });

    // Check for updates on startup (but not immediately)
    setTimeout(() => {
      this.checkForUpdates();
    }, 5000); // Wait 5 seconds after startup
  }

  static async checkForUpdates(): Promise<void> {
    try {
      logger.info("Checking for updates...");
      await autoUpdater.checkForUpdates();
    } catch (error: any) {
      logger.error("Error checking for updates:", error);
      this.sendUpdateStatus(
        "error",
        `Failed to check for updates: ${error.message}`
      );
    }
  }

  private static async promptForUpdate(): Promise<void> {
    if (!this.mainWindow) return;

    const updateInfo = this.updateInfo;
    if (!updateInfo) return;

    const result = await dialog.showMessageBox(this.mainWindow, {
      type: "info",
      title: "Update Available",
      message: `A new version (${updateInfo.version}) is available.`,
      detail: `Would you like to download and install the update now?\n\nRelease Date: ${
        updateInfo.releaseDate
      }${
        updateInfo.releaseNotes
          ? `\n\nRelease Notes:\n${updateInfo.releaseNotes}`
          : ""
      }`,
      buttons: ["Download Now", "Later", "Skip This Version"],
      defaultId: 0,
      cancelId: 1,
    });

    switch (result.response) {
      case 0: // Download Now
        this.downloadUpdate();
        break;
      case 1: // Later
        // User chose to download later, we'll check again next time
        break;
      case 2: // Skip This Version
        // Mark this version as skipped (could be stored in settings)
        break;
    }
  }

  private static async promptForInstall(): Promise<void> {
    if (!this.mainWindow) return;

    const result = await dialog.showMessageBox(this.mainWindow, {
      type: "info",
      title: "Update Ready",
      message: "The update has been downloaded and is ready to install.",
      detail:
        "The application will restart to install the update. Any unsaved work will be lost.",
      buttons: ["Install Now", "Install Later"],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      // Install now
      autoUpdater.quitAndInstall();
    }
  }

  private static async downloadUpdate(): Promise<void> {
    try {
      logger.info("Starting update download...");
      this.sendUpdateStatus("downloading", "Downloading update...");
      await autoUpdater.downloadUpdate();
    } catch (error: any) {
      logger.error("Error downloading update:", error);
      this.sendUpdateStatus(
        "error",
        `Failed to download update: ${error.message}`
      );

      // Fallback to manual download
      this.promptForManualDownload();
    }
  }

  private static async promptForManualDownload(): Promise<void> {
    if (!this.mainWindow) return;

    const updateInfo = this.updateInfo;
    if (!updateInfo) return;

    const result = await dialog.showMessageBox(this.mainWindow, {
      type: "warning",
      title: "Manual Download Required",
      message:
        "Automatic download failed. Would you like to download the update manually?",
      detail: `You can download version ${updateInfo.version} from the releases page.`,
      buttons: ["Open Download Page", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      // Open download page
      const { shell } = require("electron");
      await shell.openExternal(
        "https://github.com/ddalab/configmanager/releases"
      );
    }
  }

  private static sendUpdateStatus(
    status: string,
    message: string,
    data?: any
  ): void {
    if (!this.mainWindow) return;

    this.mainWindow.webContents.send("update-status", {
      status,
      message,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  static getUpdateInfo(): UpdateInfo | null {
    return this.updateInfo;
  }

  static isUpdateAvailable(): boolean {
    return this.updateAvailable;
  }

  static async forceCheckForUpdates(): Promise<void> {
    this.updateAvailable = false;
    this.updateInfo = null;
    await this.checkForUpdates();
  }
}
