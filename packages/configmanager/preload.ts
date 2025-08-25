import { contextBridge, ipcRenderer } from "electron";

// Simple preload-specific logger that respects NODE_ENV
const isDev = process.env.NODE_ENV === 'development';

const preloadLog = {
  info: (message: string, ...args: any[]) => {
    if (isDev) {
      console.log(`[preload.ts] ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: any[]) => {
    if (isDev) {
      console.warn(`[preload.ts] ${message}`, ...args);
    }
  },
  error: (message: string, ...args: any[]) => {
    // Always log errors, even in production
    console.error(`[preload.ts] ${message}`, ...args);
  },
  debug: (message: string, ...args: any[]) => {
    if (isDev) {
      console.log(`[preload.ts] DEBUG: ${message}`, ...args);
    }
  }
};

preloadLog.info("=== PRELOAD SCRIPT STARTING ===");
preloadLog.info("Script execution started at:", new Date().toISOString());
preloadLog.debug("contextBridge available:", !!contextBridge);
preloadLog.debug("ipcRenderer available:", !!ipcRenderer);

export interface DockerStatus {
  isRunning: boolean;
  statusMessage: string;
  version?: string;
  composeVersion?: string;
}

export interface DockerState {
  dockerInstalled: boolean;
  dockerComposeInstalled: boolean;
  dockerRunning: boolean;
  dockerStatusMessage: string;
  installationInstructions: string;
}

export interface ElectronAPI {
  openFile: () => Promise<string | null>;
  readFile: (filePath: string) => Promise<string | { error: string } | null>;
  writeFile: (
    filePath: string,
    content: string
  ) => Promise<{ success: boolean; error?: string }>;
  checkPath: (filePath: string) => Promise<{
    exists: boolean;
    isFile: boolean;
    isDirectory: boolean;
    message: string;
  }>;
  showSaveDialog: (defaultPath?: string) => Promise<string | null>;
  saveFile: (
    filePath: string,
    content: string
  ) => Promise<{ success: boolean; error?: string }>;
  selectDirectory: () => Promise<string | undefined>;
  loadEnvVars: (dataDir?: string) => Promise<ParsedEnvEntry[] | undefined>;
  saveEnvConfig: (targetDir: string | null, content: string) => void;
  quitApp: () => void;
  
  // Logging
  log: (level: string, context: string, message: string, args: any[]) => void;

  // Monolithic Docker Commands
  startMonolithicDocker: () => Promise<boolean>;
  stopMonolithicDocker: (deleteVolumes: boolean) => Promise<boolean>;
  getDockerStatus: () => Promise<DockerStatus>;
  getIsDockerRunning: () => Promise<boolean>;
  getDockerLogs: () => Promise<string>;
  startDockerLogStream: () => Promise<boolean>;
  removeDockerLogStream: () => Promise<void>;
  checkDdalabServicesHealth: () => Promise<boolean>;
  onDockerLogs: (
    callback: (log: { type: string; data: string }) => void
  ) => () => void;
  clearAllDockerLogListeners: () => void;
  onDockerStatusUpdate: (
    callback: (statusUpdate: { type: string; message: string }) => void
  ) => () => void;
  onDockerLogUpdate: (
    callback: (logUpdate: {
      type: string;
      message: string;
      logs?: string;
    }) => void
  ) => () => void;
  onDockerStateUpdate: (
    callback: (stateUpdate: { type: string }) => void
  ) => () => void;

  validateDockerSetup: (
    setupPath: string
  ) => Promise<{
    success: boolean;
    message: string;
    needsSetup?: boolean;
    targetPath?: string;
  }>;
  setupDockerDeployment: (
    dataLocation: string,
    setupLocation: string,
    userConfig?: any
  ) => Promise<{ success: boolean; message: string }>;
  setupDockerDirectory: (
    targetDirectory: string,
    userConfig?: any
  ) => Promise<{ success: boolean; message: string }>;

  checkDockerInstallation: () => Promise<{
    dockerInstalled: boolean;
    dockerComposeInstalled: boolean;
    dockerVersion?: string;
    dockerComposeVersion?: string;
    error?: string;
  }>;
  getDockerInstallationInstructions: () => Promise<string>;

  // Certificate Management
  checkMkcertAvailable: () => Promise<boolean>;
  installMkcert: () => Promise<{ success: boolean; error?: string }>;
  getCertificateInfo: (certsDir: string) => Promise<{
    exists: boolean;
    valid: boolean;
    expiresAt?: Date;
    daysUntilExpiry?: number;
    subjects: string[];
    isSelfSigned: boolean;
    isTrusted: boolean;
    error?: string;
  }>;
  generateTrustedCertificates: (certsDir: string) => Promise<{ success: boolean; error?: string }>;
  generateSelfSignedCertificates: (certsDir: string) => Promise<{ success: boolean; error?: string }>;
  checkCertificatesNeedRenewal: (certsDir: string) => Promise<boolean>;
  onDockerInstallationCheck: (
    callback: (data: {
      status: {
        dockerInstalled: boolean;
        dockerComposeInstalled: boolean;
        dockerVersion?: string;
        dockerComposeVersion?: string;
        error?: string;
      };
      instructions: string;
    }) => void
  ) => () => void;

  onAllServicesReady: (callback: () => void) => () => void;
  getEnvDetails: (envPath: string) => Promise<any>;
  saveEnvFile: (
    envPath: string,
    envData: Record<string, string>
  ) => Promise<void>;
  runInitialSetup: (
    dataLocation: string,
    projectLocation: string
  ) => Promise<{
    success: boolean;
    message: string;
    setupPath?: string;
  }>;
  getConfigManagerState: () => Promise<{
    setupComplete: boolean;
    setupPath: string | null;
    dataLocation?: string;
    projectLocation?: string;
    userSelections?: any;
    currentSite?: string;
    parsedEnvEntries?: any[];
    installationSuccess?: boolean | null;
    lastUpdated?: number;
    version?: string;
    error?: boolean;
  }>;
  getUserDataPath: () => Promise<string>;
  getHomeDirectory: () => Promise<string>;
  getPlatform: () => Promise<string>;
  checkDirectoryExists: (path: string) => Promise<boolean>;
  checkFileExists: (path: string) => Promise<boolean>;
  saveUserState: (
    userSelections: any,
    currentSite: string,
    parsedEnvEntries: any[],
    installationSuccess: boolean | null
  ) => Promise<void>;
  saveFullState: (
    setupPathOrDataLocation: string | null,
    projectLocation: string | null,
    userSelections: any,
    currentSite: string,
    parsedEnvEntries: any[],
    installationSuccess: boolean | null
  ) => Promise<void>;
  onSetupProgress: (
    callback: (progress: { message: string; type?: string }) => void
  ) => () => void;
  onSetupFinished: (
    callback: (state: {
      setupComplete: boolean;
      setupPath: string | null;
    }) => void
  ) => () => void;

  markSetupComplete: (manualSetupDirectory?: string) => Promise<{
    success: boolean;
    message?: string;
    finalSetupPath: string | null;
    needsClone?: boolean;
    targetPath?: string;
  }>;
  cloneRepositoryToDirectory: (
    targetDirectory: string,
    allowedDirsValue: string
  ) => Promise<{
    success: boolean;
    message: string;
    setupPath?: string;
  }>;
  // Auto-update methods
  checkForUpdates: () => Promise<void>;
  getUpdateInfo: () => Promise<{
    version: string;
    releaseDate: string;
    releaseNotes?: string;
    downloadUrl?: string;
    currentVersion?: string;
    newVersion?: string;
  } | null>;
  isUpdateAvailable: () => Promise<boolean>;
  getCurrentVersion: () => Promise<string>;
  getEnvironment: () => Promise<string>;
  getSystemInfo: () => Promise<{
    platform: string;
    nodeVersion: string;
    electronVersion: string;
    arch: string;
  }>;
  downloadUpdate: () => Promise<void>;
  testUpdateCheck: () => Promise<void>;

  // Enhanced update methods
  enhancedCheckForUpdates: () => Promise<{
    success: boolean;
    message: string;
    updateInfo?: any;
    error?: string;
  }>;
  enhancedDownloadUpdate: () => Promise<{
    success: boolean;
    message: string;
    updateInfo?: any;
    error?: string;
  }>;
  installUpdate: () => Promise<{
    success: boolean;
    message: string;
    error?: string;
  }>;
  cancelUpdate: () => Promise<void>;
  testUpdate: () => Promise<{
    success: boolean;
    message: string;
    updateInfo?: any;
    error?: string;
  }>;
  onEnhancedUpdateStatus: (
    callback: (status: {
      status: string;
      message: string;
      progress?: any;
      updateInfo?: any;
      timestamp: string;
      error?: string;
    }) => void
  ) => () => void;

  // MinIO update methods
  checkMinIOUpdate: () => Promise<{
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    lastChecked: string;
  }>;
  updateMinIO: () => Promise<{ success: boolean; message: string }>;
  getMinIOUpdateInfo: () => Promise<{
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    lastChecked: string;
  } | null>;
  onUpdateStatus: (
    callback: (data: {
      status: string;
      message: string;
      data?: any;
      timestamp: string;
    }) => void
  ) => () => void;
  // Menu action handlers
  onMenuAction: (
    callback: (data: { action: string; path?: string }) => void
  ) => () => void;

  // Quit confirmation methods
  onQuitRequest: (callback: () => void) => () => void;
  confirmQuit: () => void;
  
  // General utilities
  openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
}

interface ParsedEnvEntry {
  key: string;
  value: string;
  comments: string[];
}

const exposedAPI: ElectronAPI = {
  openFile: () => ipcRenderer.invoke("dialog:openFile"),
  readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath),
  writeFile: (filePath, content) =>
    ipcRenderer.invoke("fs:writeFile", filePath, content),
  checkPath: (filePath) => ipcRenderer.invoke("fs:checkPath", filePath),
  showSaveDialog: (defaultPath?: string) =>
    ipcRenderer.invoke("dialog:saveFile", defaultPath),
  saveFile: (filePath, content) =>
    ipcRenderer.invoke("fs:writeFile", filePath, content),
  selectDirectory: () => ipcRenderer.invoke("configmanager:select-directory"),
  loadEnvVars: (dataDir?: string) =>
    ipcRenderer.invoke("configmanager:load-env-vars", dataDir),
  saveEnvConfig: (targetDir: string | null, content: string) =>
    ipcRenderer.send("configmanager:save-env-config", targetDir, content),
  quitApp: () => ipcRenderer.send("configmanager:quit-app"),
  
  // Logging
  log: (level: string, context: string, message: string, args: any[]) =>
    ipcRenderer.send("log:message", { level, context, message, args }),

  // Monolithic Docker Commands
  startMonolithicDocker: () => ipcRenderer.invoke("start-monolithic-docker"),
  stopMonolithicDocker: (deleteVolumes?: boolean) => {
    preloadLog.debug("stopMonolithicDocker called with:", deleteVolumes);
    preloadLog.debug("About to invoke stop-monolithic-docker");
    return ipcRenderer.invoke("stop-monolithic-docker", deleteVolumes);
  },
  getDockerStatus: () => ipcRenderer.invoke("get-docker-status"),
  getIsDockerRunning: () => ipcRenderer.invoke("get-is-docker-running"),
  getDockerLogs: () => ipcRenderer.invoke("fetch-current-docker-logs"),
  startDockerLogStream: () => ipcRenderer.invoke("start-docker-log-stream"),
  removeDockerLogStream: () => ipcRenderer.invoke("remove-docker-log-stream"),
  checkDdalabServicesHealth: () => ipcRenderer.invoke("check-ddalab-services-health"),
  onDockerLogs: (callback) => {
    preloadLog.debug("Setting up onDockerLogs listener");
    const handler = (_event: any, log: { type: string; data: string }) => {
      preloadLog.debug("Received docker-logs event:", log);
      callback(log);
    };
    ipcRenderer.on("docker-logs", handler);
    return () => {
      preloadLog.debug("Removing docker-logs listener");
      ipcRenderer.removeListener("docker-logs", handler);
    };
  },
  clearAllDockerLogListeners: () => {
    ipcRenderer.removeAllListeners("docker-logs");
  },
  onDockerStatusUpdate: (callback) => {
    const handler = (
      _event: any,
      statusUpdate: { type: string; message: string }
    ) => callback(statusUpdate);
    ipcRenderer.on("docker-status-update", handler);
    return () => {
      ipcRenderer.removeListener("docker-status-update", handler);
    };
  },
  onDockerLogUpdate: (callback) => {
    const handler = (
      _event: any,
      logUpdate: { type: string; message: string; logs?: string }
    ) => callback(logUpdate);
    ipcRenderer.on("docker-log-update", handler);
    return () => {
      ipcRenderer.removeListener("docker-log-update", handler);
    };
  },
  onDockerStateUpdate: (callback) => {
    const handler = (_event: any, stateUpdate: { type: string }) =>
      callback(stateUpdate);
    ipcRenderer.on("docker-state-update", handler);
    return () => {
      ipcRenderer.removeListener("docker-state-update", handler);
    };
  },

  validateDockerSetup: (setupPath: string) =>
    ipcRenderer.invoke("validate-docker-setup", setupPath),
  setupDockerDeployment: (dataLocation: string, setupLocation: string, userConfig?: any) =>
    ipcRenderer.invoke("setup-docker-deployment", dataLocation, setupLocation, userConfig),
  setupDockerDirectory: (targetDirectory: string, userConfig?: any) =>
    ipcRenderer.invoke("setup-docker-directory", targetDirectory, userConfig),

  checkDockerInstallation: () =>
    ipcRenderer.invoke("check-docker-installation"),
  getDockerInstallationInstructions: () =>
    ipcRenderer.invoke("get-docker-installation-instructions"),

  // Certificate Management
  checkMkcertAvailable: () =>
    ipcRenderer.invoke("check-mkcert-available"),
  installMkcert: () =>
    ipcRenderer.invoke("install-mkcert"),
  getCertificateInfo: (certsDir: string) =>
    ipcRenderer.invoke("get-certificate-info", certsDir),
  generateTrustedCertificates: (certsDir: string) =>
    ipcRenderer.invoke("generate-trusted-certificates", certsDir),
  generateSelfSignedCertificates: (certsDir: string) =>
    ipcRenderer.invoke("generate-self-signed-certificates", certsDir),
  checkCertificatesNeedRenewal: (certsDir: string) =>
    ipcRenderer.invoke("check-certificates-need-renewal", certsDir),
  onDockerInstallationCheck: (
    callback: (data: {
      status: {
        dockerInstalled: boolean;
        dockerComposeInstalled: boolean;
        dockerVersion?: string;
        dockerComposeVersion?: string;
        error?: string;
      };
      instructions: string;
    }) => void
  ) => {
    const handler = (
      _event: any,
      data: {
        status: {
          dockerInstalled: boolean;
          dockerComposeInstalled: boolean;
          dockerVersion?: string;
          dockerComposeVersion?: string;
          error?: string;
        };
        instructions: string;
      }
    ) => callback(data);
    ipcRenderer.on("docker-installation-check", handler);
    return () => {
      ipcRenderer.removeListener("docker-installation-check", handler);
    };
  },

  onAllServicesReady: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("ddalab-services-ready", handler);
    return () => {
      ipcRenderer.removeListener("ddalab-services-ready", handler);
    };
  },
  getEnvDetails: (envPath: string) =>
    ipcRenderer.invoke("get-env-details", envPath),
  saveEnvFile: (envPath: string, envData: Record<string, string>) =>
    ipcRenderer.invoke("save-env-file", envPath, envData),
  runInitialSetup: (dataLocation: string, projectLocation: string) =>
    ipcRenderer.invoke("run-initial-setup", dataLocation, projectLocation),
  getConfigManagerState: () => ipcRenderer.invoke("configmanager:get-state"),
  saveUserState: (
    userSelections: any,
    currentSite: string,
    parsedEnvEntries: any[],
    installationSuccess: boolean | null
  ) =>
    ipcRenderer.invoke(
      "configmanager:save-user-state",
      userSelections,
      currentSite,
      parsedEnvEntries,
      installationSuccess
    ),
  saveFullState: (
    setupPathOrDataLocation: string | null,
    projectLocation: string | null,
    userSelections: any,
    currentSite: string,
    parsedEnvEntries: any[],
    installationSuccess: boolean | null
  ) =>
    ipcRenderer.invoke(
      "configmanager:save-full-state",
      setupPathOrDataLocation,
      projectLocation,
      userSelections,
      currentSite,
      parsedEnvEntries,
      installationSuccess
    ),
  onSetupProgress: (callback) => {
    const handler = (
      _event: any,
      progress: { message: string; type?: string }
    ) => callback(progress);
    ipcRenderer.on("setup-progress", handler);
    return () => {
      ipcRenderer.removeListener("setup-progress", handler);
    };
  },
  onSetupFinished: (callback) => {
    const handler = (
      _event: any,
      state: { setupComplete: boolean; setupPath: string | null }
    ) => callback(state);
    ipcRenderer.on("setup-finished", handler);
    return () => {
      ipcRenderer.removeListener("setup-finished", handler);
    };
  },
  markSetupComplete: (manualSetupDirectory?: string) =>
    ipcRenderer.invoke("mark-setup-complete", manualSetupDirectory),
  cloneRepositoryToDirectory: (
    targetDirectory: string,
    allowedDirsValue: string
  ) =>
    ipcRenderer.invoke(
      "clone-repository-to-directory",
      targetDirectory,
      allowedDirsValue
    ),
  // Auto-update methods
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  getUpdateInfo: () => ipcRenderer.invoke("get-update-info"),
  isUpdateAvailable: () => ipcRenderer.invoke("is-update-available"),
  getCurrentVersion: () => ipcRenderer.invoke("get-current-version"),
  getEnvironment: () => ipcRenderer.invoke("get-environment"),
  getSystemInfo: () => ipcRenderer.invoke("get-system-info"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  testUpdateCheck: () => ipcRenderer.invoke("test-update-check"),
  getUserDataPath: () => ipcRenderer.invoke("get-user-data-path"),
  getHomeDirectory: () => ipcRenderer.invoke("get-home-directory"),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
  checkDirectoryExists: (path: string) => ipcRenderer.invoke("check-directory-exists", path),
  checkFileExists: (path: string) => ipcRenderer.invoke("check-file-exists", path),

  // Enhanced update methods
  enhancedCheckForUpdates: () =>
    ipcRenderer.invoke("enhanced-check-for-updates"),
  enhancedDownloadUpdate: () => ipcRenderer.invoke("enhanced-download-update"),
  installUpdate: () => ipcRenderer.invoke("enhanced-install-update"),
  cancelUpdate: () => ipcRenderer.invoke("enhanced-cancel-update"),
  testUpdate: () => ipcRenderer.invoke("enhanced-test-update"),
  onEnhancedUpdateStatus: (callback: (status: any) => void) => {
    const handler = (_event: any, status: any) => callback(status);
    ipcRenderer.on("enhanced-update-status", handler);
    return () => ipcRenderer.removeListener("enhanced-update-status", handler);
  },

  // MinIO update methods
  checkMinIOUpdate: () => ipcRenderer.invoke("check-minio-update"),
  updateMinIO: () => ipcRenderer.invoke("update-minio"),
  getMinIOUpdateInfo: () => ipcRenderer.invoke("get-minio-update-info"),
  onUpdateStatus: (callback) => {
    const handler = (
      _event: any,
      data: {
        status: string;
        message: string;
        data?: any;
        timestamp: string;
      }
    ) => callback(data);
    ipcRenderer.on("update-status", handler);
    return () => {
      ipcRenderer.removeListener("update-status", handler);
    };
  },
  // Menu action handlers
  onMenuAction: (callback) => {
    const handler = (_event: any, data: { action: string; path?: string }) =>
      callback(data);
    ipcRenderer.on("menu-action", handler);
    return () => {
      ipcRenderer.removeListener("menu-action", handler);
    };
  },

  // Quit confirmation methods
  onQuitRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("quit-request", handler);
    return () => {
      ipcRenderer.removeListener("quit-request", handler);
    };
  },
  confirmQuit: () => ipcRenderer.invoke("app:confirmQuit"),
  
  // General utilities
  openExternalUrl: (url: string) => ipcRenderer.invoke("open-external-url", url),
};

preloadLog.debug("About to expose electronAPI to main world");
preloadLog.debug("exposedAPI keys:", Object.keys(exposedAPI));
preloadLog.debug(
  "stopMonolithicDocker type:",
  typeof exposedAPI.stopMonolithicDocker
);

contextBridge.exposeInMainWorld("electronAPI", exposedAPI);

preloadLog.info("electronAPI exposed to main world");
preloadLog.debug(
  "Checking if electronAPI is available in window:",
  typeof window !== "undefined" && "electronAPI" in window
);
