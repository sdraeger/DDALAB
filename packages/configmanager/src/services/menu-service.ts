import { app, Menu, shell, dialog, BrowserWindow, MenuItemConstructorOptions } from "electron";
import { AutoUpdateService } from "./auto-update-service";
import { DockerService } from "./docker-service";
import { EnvironmentConfigService } from "./environment-config-service";
import { logger } from "../utils/logger";

export class MenuService {
  private static mainWindow: BrowserWindow | null = null;

  static initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    this.createApplicationMenu();
  }

  private static createApplicationMenu(): void {
    const isMac = process.platform === "darwin";
    const appName = app.getName();
    const currentVersion = app.getVersion();
    const environment = EnvironmentConfigService.getCurrentEnvironment();

    const template: MenuItemConstructorOptions[] = [
      // macOS App Menu
      ...(isMac ? [{
        label: appName,
        submenu: [
          {
            label: `About ${appName}`,
            click: () => this.showAboutDialog()
          },
          { type: 'separator' as const },
          {
            label: 'Check for Updates...',
            click: () => this.checkForUpdates()
          },
          { type: 'separator' as const },
          {
            label: 'Preferences...',
            accelerator: 'CmdOrCtrl+,',
            click: () => this.showPreferences()
          },
          { type: 'separator' as const },
          {
            label: 'Services',
            submenu: []
          },
          { type: 'separator' as const },
          {
            label: `Hide ${appName}`,
            accelerator: 'Command+H',
            role: 'hide' as const
          },
          {
            label: 'Hide Others',
            accelerator: 'Command+Shift+H',
            role: 'hideothers' as const
          },
          {
            label: 'Show All',
            role: 'unhide' as const
          },
          { type: 'separator' as const },
          {
            label: `Quit ${appName}`,
            accelerator: 'Command+Q',
            click: () => app.quit()
          }
        ]
      }] : []),

      // File Menu
      {
        label: 'File',
        submenu: [
          {
            label: 'New Setup...',
            accelerator: 'CmdOrCtrl+N',
            click: () => this.startNewSetup()
          },
          {
            label: 'Open Setup Directory...',
            accelerator: 'CmdOrCtrl+O',
            click: () => this.openSetupDirectory()
          },
          { type: 'separator' as const },
          {
            label: 'Export Configuration...',
            click: () => this.exportConfiguration()
          },
          {
            label: 'Import Configuration...',
            click: () => this.importConfiguration()
          },
          { type: 'separator' as const },
          ...(!isMac ? [
            {
              label: 'Preferences...',
              accelerator: 'CmdOrCtrl+,',
              click: () => this.showPreferences()
            },
            { type: 'separator' as const }
          ] : []),
          ...(!isMac ? [{
            label: 'Exit',
            accelerator: 'CmdOrCtrl+Q',
            click: () => app.quit()
          }] : [])
        ]
      },

      // Edit Menu
      {
        label: 'Edit',
        submenu: [
          { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' as const },
          { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' as const },
          { type: 'separator' as const },
          { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' as const },
          { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' as const },
          { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' as const },
          { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' as const }
        ]
      },

      // Setup Menu
      {
        label: 'Setup',
        submenu: [
          {
            label: 'Restart Setup Wizard',
            click: () => this.restartSetupWizard()
          },
          {
            label: 'Reset All Settings',
            click: () => this.resetAllSettings()
          },
          { type: 'separator' as const },
          {
            label: 'Validate Current Setup',
            click: () => this.validateCurrentSetup()
          },
          {
            label: 'Check Docker Installation',
            click: () => this.checkDockerInstallation()
          }
        ]
      },

      // Docker Menu
      {
        label: 'Docker',
        submenu: [
          {
            label: 'Start Services',
            click: () => this.startDockerServices()
          },
          {
            label: 'Stop Services',
            click: () => this.stopDockerServices()
          },
          {
            label: 'Restart Services',
            click: () => this.restartDockerServices()
          },
          { type: 'separator' as const },
          {
            label: 'View Logs',
            click: () => this.viewDockerLogs()
          },
          {
            label: 'Open Docker Desktop',
            click: () => this.openDockerDesktop()
          },
          { type: 'separator' as const },
          {
            label: 'Check Services Status',
            click: () => this.checkDockerStatus()
          },
          {
            label: 'Reset Docker Volumes',
            click: () => this.resetDockerVolumes()
          }
        ]
      },

      // View Menu
      {
        label: 'View',
        submenu: [
          { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' as const },
          { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' as const },
          { label: 'Toggle Developer Tools', accelerator: 'F12', role: 'toggleDevTools' as const },
          { type: 'separator' as const },
          { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' as const },
          { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' as const },
          { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' as const },
          { type: 'separator' as const },
          { label: 'Toggle Fullscreen', accelerator: isMac ? 'Ctrl+Command+F' : 'F11', role: 'togglefullscreen' as const }
        ]
      },

      // Window Menu
      {
        label: 'Window',
        submenu: [
          { label: 'Minimize', accelerator: 'CmdOrCtrl+M', role: 'minimize' as const },
          { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' as const },
          ...(isMac ? [
            { type: 'separator' as const },
            { label: 'Bring All to Front', role: 'front' as const }
          ] : [])
        ]
      },

      // Help Menu
      {
        label: 'Help',
        submenu: [
          {
            label: 'DDALAB Documentation',
            click: () => shell.openExternal('https://github.com/sdraeger/DDALAB#readme')
          },
          {
            label: 'Docker Setup Guide',
            click: () => shell.openExternal('https://docs.docker.com/get-docker/')
          },
          {
            label: 'Troubleshooting Guide',
            click: () => this.showTroubleshootingGuide()
          },
          { type: 'separator' as const },
          {
            label: 'Report Issue',
            click: () => shell.openExternal('https://github.com/sdraeger/DDALAB/issues/new')
          },
          {
            label: 'View Logs',
            click: () => this.viewApplicationLogs()
          },
          { type: 'separator' as const },
          ...(!isMac ? [{
            label: `About ${appName}`,
            click: () => this.showAboutDialog()
          }] : [])
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  // Menu Action Implementations
  private static async showAboutDialog(): Promise<void> {
    const version = app.getVersion();
    const environment = EnvironmentConfigService.getCurrentEnvironment();

    await dialog.showMessageBox(this.mainWindow!, {
      type: 'info',
      title: 'About DDALAB ConfigManager',
      message: 'DDALAB ConfigManager',
      detail: `Version: ${version}\nEnvironment: ${environment}\n\nA configuration manager for DDALAB Docker deployments.\n\n© 2024 DDALAB Project`,
      buttons: ['OK']
    });
  }

  private static async checkForUpdates(): Promise<void> {
    try {
      await AutoUpdateService.forceCheckForUpdates();
      const updateInfo = AutoUpdateService.getUpdateInfo();

      if (!updateInfo || !AutoUpdateService.isUpdateAvailable()) {
        await dialog.showMessageBox(this.mainWindow!, {
          type: 'info',
          title: 'No Updates Available',
          message: 'You are running the latest version.',
          buttons: ['OK']
        });
      }
    } catch (error) {
      logger.error('Error checking for updates:', error);
      await dialog.showErrorBox('Update Check Failed', 'Failed to check for updates. Please try again later.');
    }
  }

  private static showPreferences(): void {
    // Send message to renderer to show preferences
    this.mainWindow?.webContents.send('show-preferences');
  }

  private static startNewSetup(): void {
    this.mainWindow?.webContents.send('menu-action', { action: 'new-setup' });
  }

  private static async openSetupDirectory(): Promise<void> {
    const result = await dialog.showOpenDialog(this.mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Setup Directory'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      this.mainWindow?.webContents.send('menu-action', {
        action: 'open-setup-directory',
        path: result.filePaths[0]
      });
    }
  }

  private static async exportConfiguration(): Promise<void> {
    const result = await dialog.showSaveDialog(this.mainWindow!, {
      title: 'Export Configuration',
      defaultPath: 'ddalab-config.json',
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!result.canceled && result.filePath) {
      this.mainWindow?.webContents.send('menu-action', {
        action: 'export-configuration',
        path: result.filePath
      });
    }
  }

  private static async importConfiguration(): Promise<void> {
    const result = await dialog.showOpenDialog(this.mainWindow!, {
      properties: ['openFile'],
      title: 'Import Configuration',
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      this.mainWindow?.webContents.send('menu-action', {
        action: 'import-configuration',
        path: result.filePaths[0]
      });
    }
  }

  private static restartSetupWizard(): void {
    this.mainWindow?.webContents.send('menu-action', { action: 'restart-setup-wizard' });
  }

  private static async resetAllSettings(): Promise<void> {
    const result = await dialog.showMessageBox(this.mainWindow!, {
      type: 'warning',
      title: 'Reset All Settings',
      message: 'Are you sure you want to reset all settings?',
      detail: 'This will clear all configuration data and restart the setup process.',
      buttons: ['Cancel', 'Reset'],
      defaultId: 0,
      cancelId: 0
    });

    if (result.response === 1) {
      this.mainWindow?.webContents.send('menu-action', { action: 'reset-all-settings' });
    }
  }

  private static validateCurrentSetup(): void {
    this.mainWindow?.webContents.send('menu-action', { action: 'validate-current-setup' });
  }

  private static async checkDockerInstallation(): Promise<void> {
    try {
      const status = await DockerService.checkDockerInstallation();
      const message = status.dockerInstalled && status.dockerComposeInstalled
        ? `Docker is properly installed.\n\nDocker: ${status.dockerVersion}\nDocker Compose: ${status.dockerComposeVersion}`
        : `Docker installation issues detected:\n\nDocker Installed: ${status.dockerInstalled ? 'Yes' : 'No'}\nDocker Compose Installed: ${status.dockerComposeInstalled ? 'Yes' : 'No'}`;

      await dialog.showMessageBox(this.mainWindow!, {
        type: status.dockerInstalled && status.dockerComposeInstalled ? 'info' : 'warning',
        title: 'Docker Installation Status',
        message: 'Docker Installation Check',
        detail: message,
        buttons: ['OK']
      });
    } catch (error) {
      logger.error('Error checking Docker installation:', error);
      await dialog.showErrorBox('Docker Check Failed', 'Failed to check Docker installation.');
    }
  }

  private static startDockerServices(): void {
    this.mainWindow?.webContents.send('menu-action', { action: 'start-docker-services' });
  }

  private static stopDockerServices(): void {
    this.mainWindow?.webContents.send('menu-action', { action: 'stop-docker-services' });
  }

  private static async restartDockerServices(): Promise<void> {
    this.mainWindow?.webContents.send('menu-action', { action: 'restart-docker-services' });
  }

  private static viewDockerLogs(): void {
    this.mainWindow?.webContents.send('menu-action', { action: 'view-docker-logs' });
  }

  private static openDockerDesktop(): void {
    if (process.platform === 'darwin') {
      shell.openPath('/Applications/Docker.app');
    } else if (process.platform === 'win32') {
      shell.openPath('docker-desktop://');
    } else {
      // Linux - try common paths
      shell.openExternal('https://docs.docker.com/desktop/');
    }
  }

  private static checkDockerStatus(): void {
    this.mainWindow?.webContents.send('menu-action', { action: 'check-docker-status' });
  }

  private static async resetDockerVolumes(): Promise<void> {
    const result = await dialog.showMessageBox(this.mainWindow!, {
      type: 'warning',
      title: 'Reset Docker Volumes',
      message: 'Are you sure you want to reset Docker volumes?',
      detail: 'This will delete all data stored in Docker volumes. This action cannot be undone.',
      buttons: ['Cancel', 'Reset Volumes'],
      defaultId: 0,
      cancelId: 0
    });

    if (result.response === 1) {
      this.mainWindow?.webContents.send('menu-action', { action: 'reset-docker-volumes' });
    }
  }

  private static showTroubleshootingGuide(): void {
    this.mainWindow?.webContents.send('menu-action', { action: 'show-troubleshooting-guide' });
  }

  private static viewApplicationLogs(): void {
    this.mainWindow?.webContents.send('menu-action', { action: 'view-application-logs' });
  }

  static updateMenuState(state: { dockerRunning?: boolean; setupComplete?: boolean }): void {
    // Dynamic menu updates could be implemented here
    // For now, we'll keep the static menu structure
  }
}
