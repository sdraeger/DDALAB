import { app, Tray, Menu, BrowserWindow, nativeImage } from "electron";
import path from "path";
import { logger } from "../utils/logger";
import { DockerService } from "./docker-service";
import { SetupService } from "./setup-service";

export class SystemTrayService {
  private static tray: Tray | null = null;
  private static mainWindow: BrowserWindow | null = null;
  private static isQuitting = false;

  static initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    this.createTray();
  }

  private static createTray(): void {
    // Create tray icon
    const iconPath = this.getTrayIconPath();
    const icon = nativeImage.createFromPath(iconPath);

    // Resize icon for system tray (different platforms have different requirements)
    const resizedIcon = icon.resize({ width: 16, height: 16 });

    this.tray = new Tray(resizedIcon);
    this.tray.setToolTip("DDALAB ConfigManager");

    // Create context menu
    this.updateTrayMenu();

    // Handle tray icon click
    this.tray.on("click", () => {
      this.toggleMainWindow();
    });

    logger.info("System tray initialized");
  }

  private static getTrayIconPath(): string {
    const platform = process.platform;
    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      // Use a simple icon for development
      return path.join(__dirname, "..", "assets", "tray-icon.png");
    }

    // Production paths
    switch (platform) {
      case "darwin":
        return path.join(process.resourcesPath, "tray-icon.png");
      case "win32":
        return path.join(process.resourcesPath, "tray-icon.ico");
      case "linux":
        return path.join(process.resourcesPath, "tray-icon.png");
      default:
        return path.join(process.resourcesPath, "tray-icon.png");
    }
  }

  private static async updateTrayMenu(): Promise<void> {
    if (!this.tray) return;

    const state = await SetupService.getConfigManagerState();
    const isDockerRunning = DockerService.getIsDockerRunning();

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: "DDALAB ConfigManager",
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Show/Hide Window",
        click: () => this.toggleMainWindow(),
      },
      { type: "separator" },
      {
        label: isDockerRunning
          ? "Stop Docker Services"
          : "Start Docker Services",
        click: () => this.toggleDockerServices(),
        enabled: state.setupComplete,
      },
      {
        label: "Docker Status",
        submenu: [
          {
            label: isDockerRunning ? "Running" : "Stopped",
            enabled: false,
          },
          {
            label: "Check Installation",
            click: () => this.checkDockerInstallation(),
          },
        ],
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => this.quitApp(),
      },
    ];

    const contextMenu = Menu.buildFromTemplate(template);
    this.tray.setContextMenu(contextMenu);
  }

  private static toggleMainWindow(): void {
    if (!this.mainWindow) return;

    if (this.mainWindow.isVisible()) {
      this.mainWindow.hide();
    } else {
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  private static async toggleDockerServices(): Promise<void> {
    if (!this.mainWindow) return;

    const state = await SetupService.getConfigManagerState();
    if (!state.setupComplete || !state.setupPath) {
      logger.error("Cannot toggle Docker services: setup not complete");
      return;
    }

    const isDockerRunning = DockerService.getIsDockerRunning();

    if (isDockerRunning) {
      // Stop services
      const success = await DockerService.stopDockerCompose(state);
      if (success) {
        this.mainWindow.webContents.send("docker-status-update", {
          type: "success",
          message: "Docker services stopped via system tray",
        });
      }
    } else {
      // Start services
      const success = await DockerService.startDockerCompose(state);
      if (success) {
        this.mainWindow.webContents.send("docker-status-update", {
          type: "success",
          message: "Docker services started via system tray",
        });
      }
    }

    // Update tray menu
    this.updateTrayMenu();
  }

  private static async checkDockerInstallation(): Promise<void> {
    if (!this.mainWindow) return;

    const status = await DockerService.checkDockerInstallation();

    if (!status.dockerInstalled || !status.dockerComposeInstalled) {
      const instructions = DockerService.getDockerInstallationInstructions();

      this.mainWindow.webContents.send("docker-status-update", {
        type: "error",
        message: "Docker installation check failed",
      });

      // Show dialog with installation instructions
      this.mainWindow.webContents.send("show-docker-installation-dialog", {
        status,
        instructions,
      });
    } else {
      this.mainWindow.webContents.send("docker-status-update", {
        type: "success",
        message: `Docker installation verified: ${status.dockerVersion}, ${status.dockerComposeVersion}`,
      });
    }
  }

  static updateTrayIcon(isRunning: boolean): void {
    if (!this.tray) return;

    // Update tooltip based on status
    const tooltip = isRunning
      ? "DDALAB ConfigManager (Docker Running)"
      : "DDALAB ConfigManager (Docker Stopped)";

    this.tray.setToolTip(tooltip);

    // Update menu
    this.updateTrayMenu();
  }

  private static quitApp(): void {
    // Send quit request to renderer instead of directly quitting
    if (this.mainWindow) {
      this.mainWindow.webContents.send("quit-request");
    } else {
      // Fallback: quit directly if no main window
      this.isQuitting = true;
      app.quit();
    }
  }

  static getIsQuitting(): boolean {
    return this.isQuitting;
  }

  static setIsQuitting(value: boolean): void {
    this.isQuitting = value;
  }

  static destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
