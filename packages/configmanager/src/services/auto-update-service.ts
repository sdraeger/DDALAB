import { autoUpdater } from "electron-updater";
import { app, BrowserWindow, dialog } from "electron";
import { logger } from "../utils/logger";

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
  downloadUrl?: string;
  currentVersion?: string;
  newVersion?: string;
}

export class AutoUpdateService {
  private static mainWindow: BrowserWindow | null = null;
  private static updateAvailable: boolean = false;
  private static updateInfo: UpdateInfo | null = null;
  private static currentVersion: string;

  static initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    this.currentVersion = app.getVersion();
    logger.info(
      `AutoUpdateService initialized. Current version: ${this.currentVersion}`
    );
    this.setupAutoUpdater();
  }

  private static setupAutoUpdater(): void {
    // Configure auto-updater for S3
    autoUpdater.autoDownload = false; // Don't auto-download, ask user first
    autoUpdater.autoInstallOnAppQuit = true;

    // Configure S3 update server - this will be overridden by configureUpdateChannel
    autoUpdater.setFeedURL({
      provider: "s3",
      bucket: "ddalab-configmanager-updates",
      region: "us-east-1",
      channel: "development",
      path: "dev",
    });

    logger.info("Auto-updater initialized with default S3 configuration");

    // Set up event listeners
    autoUpdater.on("checking-for-update", () => {
      logger.info("Auto-updater: Checking for updates from S3...");
      this.sendUpdateStatus("checking", "Checking for updates from S3...");
    });

    autoUpdater.on("update-available", (info) => {
      logger.info("Auto-updater: Update available from S3:", info);
      this.updateAvailable = true;
      this.updateInfo = {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes:
          typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
        currentVersion: this.currentVersion,
        newVersion: info.version,
      };
      this.sendUpdateStatus("available", "Update available from S3", info);
      this.promptForUpdate();
    });

    autoUpdater.on("update-not-available", (info) => {
      logger.info("Auto-updater: No updates available from S3:", info);
      this.updateAvailable = false;
      this.updateInfo = null;
      this.sendUpdateStatus("not-available", "No updates available from S3");
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
      logger.info("Update downloaded from S3:", info);
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
      logger.info("Checking for updates from S3...");
      logger.info(`Current version: ${this.currentVersion}`);

      await autoUpdater.checkForUpdates();

      // If no events were triggered, log that no update was found
      setTimeout(() => {
        if (!this.updateAvailable) {
          logger.info("No update available - current version is up to date");
          this.sendUpdateStatus(
            "not-available",
            "No updates available from S3"
          );
        }
      }, 2000); // Wait 2 seconds to see if any update events fire
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

    const currentVersion = updateInfo.currentVersion || this.currentVersion;
    const newVersion = updateInfo.newVersion || updateInfo.version;

    const result = await dialog.showMessageBox(this.mainWindow, {
      type: "info",
      title: "Update Available",
      message: `A new version of DDALAB ConfigManager is available.`,
      detail: `Current Version: ${currentVersion}\nNew Version: ${newVersion}\n\nRelease Date: ${
        updateInfo.releaseDate
      }${
        updateInfo.releaseNotes
          ? `\n\nRelease Notes:\n${updateInfo.releaseNotes}`
          : ""
      }\n\nWould you like to download and install this update now?`,
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
        logger.info("User chose to download update later");
        break;
      case 2: // Skip This Version
        // Mark this version as skipped (could be stored in settings)
        logger.info("User chose to skip this version");
        break;
    }
  }

  private static async promptForInstall(): Promise<void> {
    if (!this.mainWindow) return;

    const updateInfo = this.updateInfo;
    const currentVersion = updateInfo?.currentVersion || this.currentVersion;
    const newVersion =
      updateInfo?.newVersion || updateInfo?.version || "Unknown";

    const result = await dialog.showMessageBox(this.mainWindow, {
      type: "info",
      title: "Update Ready to Install",
      message: "The update has been downloaded and is ready to install.",
      detail: `Current Version: ${currentVersion}\nNew Version: ${newVersion}\n\nThe application will restart to install the update. Any unsaved work will be lost.`,
      buttons: ["Install Now", "Install Later"],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      // Install now
      logger.info("User chose to install update now");
      autoUpdater.quitAndInstall();
    } else {
      logger.info("User chose to install update later");
    }
  }

  private static async downloadUpdate(): Promise<void> {
    try {
      logger.info("Starting update download from S3...");
      this.sendUpdateStatus("downloading", "Downloading update from S3...");
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

    const currentVersion = updateInfo.currentVersion || this.currentVersion;
    const newVersion = updateInfo.newVersion || updateInfo.version;

    const result = await dialog.showMessageBox(this.mainWindow, {
      type: "warning",
      title: "Manual Download Required",
      message:
        "Automatic download failed. Would you like to download the update manually?",
      detail: `Current Version: ${currentVersion}\nNew Version: ${newVersion}\n\nYou can download the update manually from the S3 bucket.`,
      buttons: ["Open Download Page", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      // Open S3 bucket page
      const { shell } = require("electron");
      await shell.openExternal(
        "https://ddalab-configmanager-updates.s3.amazonaws.com/"
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

  static getCurrentVersion(): string {
    return this.currentVersion;
  }

  static async forceCheckForUpdates(): Promise<void> {
    this.updateAvailable = false;
    this.updateInfo = null;
    await this.checkForUpdates();
  }

  // Method to test update mechanism (for development)
  static async testUpdateCheck(): Promise<void> {
    logger.info("Testing update check mechanism...");

    // Simulate a test update scenario
    const testUpdateInfo: UpdateInfo = {
      version: "1.0.1-dev.2",
      releaseDate: new Date().toISOString(),
      releaseNotes: "Test update for development",
      currentVersion: this.currentVersion,
      newVersion: "1.0.1-dev.2",
    };

    this.updateAvailable = true;
    this.updateInfo = testUpdateInfo;

    logger.info("Test update scenario created:", testUpdateInfo);
    this.sendUpdateStatus("available", "Test update available", testUpdateInfo);
  }

  // Method to check S3 configuration and connectivity
  static async checkS3Configuration(): Promise<void> {
    logger.info("Checking S3 configuration and connectivity...");

    try {
      // This will trigger a real update check to test S3 connectivity
      await autoUpdater.checkForUpdates();
      logger.info("S3 configuration test completed");
    } catch (error: any) {
      logger.error("S3 configuration test failed:", error);
    }
  }

  // Method to configure update channel based on environment
  static configureUpdateChannel(
    environment: "dev" | "beta" | "production"
  ): void {
    const config = {
      dev: { channel: "development", path: "dev" },
      beta: { channel: "beta", path: "beta" },
      production: { channel: "latest", path: "production" },
    };

    const { channel, path } = config[environment];

    logger.info(`Configuring auto-updater for ${environment} environment...`);
    logger.info(
      `S3 Configuration: bucket=ddalab-configmanager-updates, region=us-east-1, channel=${channel}, path=${path}`
    );

    autoUpdater.setFeedURL({
      provider: "s3",
      bucket: "ddalab-configmanager-updates",
      region: "us-east-1",
      channel,
      path,
    });

    logger.info(
      `Auto-updater configured for ${environment} environment (channel: ${channel}, path: ${path})`
    );
  }
}
