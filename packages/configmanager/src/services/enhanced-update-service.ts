import { autoUpdater } from "electron-updater";
import { app, BrowserWindow, ipcMain } from "electron";
import { logger } from "../utils/logger";
import type {
  IUpdateService,
  UpdateInfo,
  UpdateProgress,
  UpdateStatus,
  UpdateResult,
  UpdateStatusType
} from "../types/update-types";

/**
 * Enhanced Update Service following SOLID principles
 *
 * S - Single Responsibility: Handles only update-related operations
 * O - Open/Closed: Extensible through interfaces without modification
 * L - Liskov Substitution: Implements IUpdateService interface
 * I - Interface Segregation: Uses focused interfaces
 * D - Dependency Inversion: Depends on abstractions (interfaces)
 */
export class EnhancedUpdateService implements IUpdateService {
  private static instance: EnhancedUpdateService;
  private mainWindow: BrowserWindow | null = null;
  private updateAvailable: boolean = false;
  private updateInfo: UpdateInfo | null = null;
  private currentVersion: string;
  private downloadProgress: UpdateProgress | null = null;
  private isInitialized: boolean = false;
  private statusCallbacks: ((status: UpdateStatus) => void)[] = [];
  private progressCallbacks: ((progress: UpdateProgress) => void)[] = [];
  private isDevelopmentMode: boolean = false;

  private constructor() {
    this.currentVersion = app.getVersion();
    this.isDevelopmentMode = !app.isPackaged;
  }

  /**
   * Singleton pattern for service access
   */
  public static getInstance(): EnhancedUpdateService {
    if (!EnhancedUpdateService.instance) {
      EnhancedUpdateService.instance = new EnhancedUpdateService();
    }
    return EnhancedUpdateService.instance;
  }

  /**
   * Initialize the update service
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    logger.info(`EnhancedUpdateService initializing. Current version: ${this.currentVersion}`);
    logger.info(`Development mode: ${this.isDevelopmentMode}`);

    this.setupAutoUpdater();
    this.setupIpcHandlers();
    this.isInitialized = true;

    // Auto-check for updates on startup (delayed)
    setTimeout(() => {
      this.checkForUpdates();
    }, 5000);
  }

  /**
   * Set the main window reference
   */
  public setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Configure auto-updater based on environment
   */
  private setupAutoUpdater(): void {
    // Configure for development, beta, or production
    const environment = process.env.NODE_ENV || 'development';
    const config = {
      development: { channel: "development", path: "dev" },
      beta: { channel: "beta", path: "beta" },
      production: { channel: "latest", path: "production" }
    };

    const { channel, path } = config[environment as keyof typeof config] || config.development;

    autoUpdater.autoDownload = false; // Manual download control
    autoUpdater.autoInstallOnAppQuit = false; // Manual install control

    if (!this.isDevelopmentMode) {
      autoUpdater.setFeedURL({
        provider: "s3",
        bucket: "ddalab-configmanager-updates",
        region: "us-east-1",
        channel,
        path,
      });
    }

    // Set up event listeners
    this.setupAutoUpdaterEvents();
  }

  /**
   * Set up auto-updater event handlers
   */
  private setupAutoUpdaterEvents(): void {
    autoUpdater.on("checking-for-update", () => {
      logger.info("Auto-updater: Checking for updates...");
      this.notifyStatus({
        status: 'checking',
        message: 'Checking for updates...',
        timestamp: new Date().toISOString()
      });
    });

    autoUpdater.on("update-available", (info) => {
      logger.info("Auto-updater: Update available:", info);
      this.updateAvailable = true;
      this.updateInfo = {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
        currentVersion: this.currentVersion,
        newVersion: info.version,
        fileSize: info.files?.[0]?.size
      };

      this.notifyStatus({
        status: 'available',
        message: `Update available: v${info.version}`,
        updateInfo: this.updateInfo,
        timestamp: new Date().toISOString()
      });
    });

    autoUpdater.on("update-not-available", (info) => {
      logger.info("Auto-updater: No updates available:", info);
      this.updateAvailable = false;
      this.updateInfo = null;

      this.notifyStatus({
        status: 'not-available',
        message: 'Your application is up to date',
        timestamp: new Date().toISOString()
      });
    });

    autoUpdater.on("error", (error) => {
      logger.error("Auto-updater error:", error);

      let errorMessage = error.message;
      let status: UpdateStatusType = 'error';

      // Handle development mode gracefully
      if (this.isDevelopmentMode) {
        errorMessage = 'Updates are not available in development mode. Please build and package the application to test updates.';
        status = 'not-available';
      }

      this.notifyStatus({
        status,
        message: errorMessage,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    });

    autoUpdater.on("download-progress", (progressObj) => {
      this.downloadProgress = {
        percent: progressObj.percent,
        bytesPerSecond: progressObj.bytesPerSecond,
        transferred: progressObj.transferred,
        total: progressObj.total
      };

      const logMessage = `Download progress: ${Math.round(progressObj.percent)}% (${this.formatBytes(progressObj.transferred)}/${this.formatBytes(progressObj.total)}) at ${this.formatBytes(progressObj.bytesPerSecond)}/s`;
      logger.info(logMessage);

      this.notifyStatus({
        status: 'downloading',
        message: `Downloading update: ${Math.round(progressObj.percent)}%`,
        progress: this.downloadProgress,
        timestamp: new Date().toISOString()
      });

      // Notify progress callbacks
      this.progressCallbacks.forEach(callback => callback(this.downloadProgress!));
    });

    autoUpdater.on("update-downloaded", (info) => {
      logger.info("Update downloaded:", info);
      this.notifyStatus({
        status: 'downloaded',
        message: 'Update downloaded and ready to install',
        updateInfo: this.updateInfo,
        timestamp: new Date().toISOString()
      });
    });
  }

  /**
   * Set up IPC handlers for renderer communication
   */
  private setupIpcHandlers(): void {
    ipcMain.handle("enhanced-check-for-updates", async (): Promise<UpdateResult> => {
      return await this.forceCheck();
    });

    ipcMain.handle("enhanced-download-update", async (): Promise<UpdateResult> => {
      if (!this.updateInfo) {
        return { success: false, message: "No update available to download" };
      }
      return await this.downloadUpdate(this.updateInfo);
    });

    ipcMain.handle("enhanced-install-update", async (): Promise<UpdateResult> => {
      return await this.installUpdate();
    });

    ipcMain.handle("enhanced-cancel-update", async (): Promise<void> => {
      // Note: electron-updater doesn't support cancelling downloads
      // This is a limitation we acknowledge
      logger.info("Update cancellation requested (not supported by electron-updater)");
    });

    ipcMain.handle("enhanced-get-update-info", () => {
      return this.getUpdateInfo();
    });

    ipcMain.handle("enhanced-is-update-available", () => {
      return this.isUpdateAvailable();
    });

    ipcMain.handle("enhanced-get-current-version", () => {
      return this.getCurrentVersion();
    });

    ipcMain.handle("enhanced-test-update", async (): Promise<UpdateResult> => {
      return await this.testUpdate();
    });
  }

  // IUpdateChecker implementation
  public async checkForUpdates(): Promise<UpdateResult> {
    try {
      if (this.isDevelopmentMode) {
        // Simulate development mode behavior
        const result: UpdateResult = {
          success: false,
          message: "Updates are not available in development mode",
          error: "Application is not packed"
        };

        this.notifyStatus({
          status: 'not-available',
          message: result.message,
          error: result.error,
          timestamp: new Date().toISOString()
        });

        return result;
      }

      logger.info("Checking for updates...");
      await autoUpdater.checkForUpdates();

      // Wait for result (auto-updater is event-based)
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({
            success: false,
            message: "Update check timed out"
          });
        }, 30000); // 30 second timeout

        const unsubscribe = this.onStatusChange((status) => {
          if (['available', 'not-available', 'error'].includes(status.status)) {
            clearTimeout(timeout);
            unsubscribe();
            resolve({
              success: status.status !== 'error',
              message: status.message,
              updateInfo: status.updateInfo,
              error: status.error
            });
          }
        });
      });
    } catch (error: any) {
      const result: UpdateResult = {
        success: false,
        message: `Failed to check for updates: ${error.message}`,
        error: error.message
      };

      this.notifyStatus({
        status: 'error',
        message: result.message,
        error: result.error,
        timestamp: new Date().toISOString()
      });

      return result;
    }
  }

  public getCurrentVersion(): string {
    return this.currentVersion;
  }

  public isUpdateAvailable(): boolean {
    return this.updateAvailable;
  }

  public getUpdateInfo(): UpdateInfo | null {
    return this.updateInfo;
  }

  // IUpdateDownloader implementation
  public async downloadUpdate(updateInfo: UpdateInfo): Promise<UpdateResult> {
    try {
      if (this.isDevelopmentMode) {
        return {
          success: false,
          message: "Downloads are not available in development mode",
          error: "Application is not packed"
        };
      }

      logger.info("Starting update download...");
      this.notifyStatus({
        status: 'downloading',
        message: 'Starting download...',
        updateInfo,
        timestamp: new Date().toISOString()
      });

      await autoUpdater.downloadUpdate();

      return {
        success: true,
        message: "Download started successfully",
        updateInfo
      };
    } catch (error: any) {
      const result: UpdateResult = {
        success: false,
        message: `Failed to start download: ${error.message}`,
        error: error.message
      };

      this.notifyStatus({
        status: 'error',
        message: result.message,
        error: result.error,
        timestamp: new Date().toISOString()
      });

      return result;
    }
  }

  public async cancelDownload(): Promise<void> {
    // electron-updater doesn't support cancelling downloads
    logger.warn("Download cancellation requested but not supported by electron-updater");
  }

  public getDownloadProgress(): UpdateProgress | null {
    return this.downloadProgress;
  }

  // IUpdateInstaller implementation
  public async installUpdate(): Promise<UpdateResult> {
    try {
      if (!this.isUpdateReady()) {
        return {
          success: false,
          message: "No update ready to install"
        };
      }

      logger.info("Installing update and restarting...");
      this.notifyStatus({
        status: 'installing',
        message: 'Installing update and restarting application...',
        timestamp: new Date().toISOString()
      });

      // Give UI time to show the message
      setTimeout(() => {
        autoUpdater.quitAndInstall();
      }, 1000);

      return {
        success: true,
        message: "Update installation started"
      };
    } catch (error: any) {
      const result: UpdateResult = {
        success: false,
        message: `Failed to install update: ${error.message}`,
        error: error.message
      };

      this.notifyStatus({
        status: 'error',
        message: result.message,
        error: result.error,
        timestamp: new Date().toISOString()
      });

      return result;
    }
  }

  public async quitAndInstall(): Promise<void> {
    await this.installUpdate();
  }

  public isUpdateReady(): boolean {
    // In electron-updater, we assume update is ready after 'update-downloaded' event
    return this.updateAvailable && this.downloadProgress?.percent === 100;
  }

  // IUpdateNotifier implementation
  public onStatusChange(callback: (status: UpdateStatus) => void): () => void {
    this.statusCallbacks.push(callback);
    return () => {
      const index = this.statusCallbacks.indexOf(callback);
      if (index > -1) {
        this.statusCallbacks.splice(index, 1);
      }
    };
  }

  public onProgressChange(callback: (progress: UpdateProgress) => void): () => void {
    this.progressCallbacks.push(callback);
    return () => {
      const index = this.progressCallbacks.indexOf(callback);
      if (index > -1) {
        this.progressCallbacks.splice(index, 1);
      }
    };
  }

  public notify(status: UpdateStatus): void {
    this.notifyStatus(status);
  }

  // Additional methods
  public async forceCheck(): Promise<UpdateResult> {
    this.updateAvailable = false;
    this.updateInfo = null;
    this.downloadProgress = null;
    return await this.checkForUpdates();
  }

  public async testUpdate(): Promise<UpdateResult> {
    logger.info("Running test update scenario...");

    // Simulate a test update
    const testUpdateInfo: UpdateInfo = {
      version: "1.0.1-dev.2",
      releaseDate: new Date().toISOString(),
      releaseNotes: "This is a test update for development and testing purposes.",
      currentVersion: this.currentVersion,
      newVersion: "1.0.1-dev.2",
      fileSize: 50 * 1024 * 1024 // 50MB fake size
    };

    this.updateAvailable = true;
    this.updateInfo = testUpdateInfo;

    this.notifyStatus({
      status: 'available',
      message: 'Test update available',
      updateInfo: testUpdateInfo,
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      message: "Test update scenario created",
      updateInfo: testUpdateInfo
    };
  }

  /**
   * Notify all status change callbacks
   */
  private notifyStatus(status: UpdateStatus): void {
    if (this.mainWindow) {
      this.mainWindow.webContents.send("enhanced-update-status", status);
    }

    this.statusCallbacks.forEach(callback => callback(status));
  }

  /**
   * Format bytes for display
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
