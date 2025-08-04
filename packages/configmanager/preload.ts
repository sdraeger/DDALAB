import { contextBridge, ipcRenderer } from "electron";

console.log("=== PRELOAD SCRIPT STARTING ===");
console.log(
  "[preload.ts] Script execution started at:",
  new Date().toISOString()
);
console.log("[preload.ts] contextBridge available:", !!contextBridge);
console.log("[preload.ts] ipcRenderer available:", !!ipcRenderer);

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
  startDockerCompose: () => Promise<boolean>;
  stopDockerCompose: (deleteVolumes?: boolean) => Promise<boolean>;
  getDockerStatus: () => Promise<boolean>;
  getIsDockerRunning: () => Promise<boolean>;
  getDockerLogs: () => Promise<string>;
  startDockerLogStream: () => Promise<boolean>;
  onDockerLogs: (
    callback: (log: { type: string; data: string }) => void
  ) => () => void;
  clearDockerLogsListener: () => void;
  onAllServicesReady: (callback: () => void) => () => void;
  getEnvDetails: (envPath: string) => Promise<any>;
  saveEnvFile: (
    envPath: string,
    envData: Record<string, string>
  ) => Promise<void>;
  runInitialSetup: (
    dataLocation: string,
    cloneLocation: string
  ) => Promise<{
    success: boolean;
    message: string;
    setupPath?: string;
  }>;
  getConfigManagerState: () => Promise<{
    setupComplete: boolean;
    setupPath: string | null;
    dataLocation?: string;
    cloneLocation?: string;
    userSelections?: any;
    currentSite?: string;
    parsedEnvEntries?: any[];
    installationSuccess?: boolean | null;
    lastUpdated?: number;
    version?: string;
    error?: boolean;
  }>;
  saveUserState: (
    userSelections: any,
    currentSite: string,
    parsedEnvEntries: any[],
    installationSuccess: boolean | null
  ) => Promise<void>;
  saveFullState: (
    setupPathOrDataLocation: string | null,
    cloneLocation: string | null,
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
  // Docker-based deployment methods
  validateDockerSetup: (setupPath: string) => Promise<{
    success: boolean;
    message?: string;
    setupPath?: string;
    needsSetup?: boolean;
    targetPath?: string;
  }>;
  setupDockerDeployment: (
    dataLocation: string,
    setupLocation: string
  ) => Promise<{
    success: boolean;
    message: string;
    setupPath?: string;
  }>;
  setupDockerDirectory: (targetDirectory: string) => Promise<{
    success: boolean;
    message: string;
    setupPath?: string;
  }>;
  // Docker installation check methods
  checkDockerInstallation: () => Promise<{
    dockerInstalled: boolean;
    dockerComposeInstalled: boolean;
    dockerVersion?: string;
    dockerComposeVersion?: string;
    error?: string;
  }>;
  getDockerInstallationInstructions: () => Promise<string>;
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
  onEnhancedUpdateStatus: (callback: (status: {
    status: string;
    message: string;
    progress?: any;
    updateInfo?: any;
    timestamp: string;
    error?: string;
  }) => void) => () => void;

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
  startDockerCompose: () => ipcRenderer.invoke("start-docker-compose"),
  stopDockerCompose: (deleteVolumes?: boolean) => {
    console.log("[preload.ts] stopDockerCompose called with:", deleteVolumes);
    console.log("[preload.ts] About to invoke stop-docker-compose");
    return ipcRenderer.invoke("stop-docker-compose", deleteVolumes);
  },
  getDockerStatus: () => ipcRenderer.invoke("get-docker-status"),
  getIsDockerRunning: () => ipcRenderer.invoke("get-is-docker-running"),
  getDockerLogs: () => ipcRenderer.invoke("fetch-current-docker-logs"),
  startDockerLogStream: () => ipcRenderer.invoke("start-docker-log-stream"),
  onDockerLogs: (callback) => {
    console.log("[preload.ts] Setting up onDockerLogs listener");
    const handler = (_event: any, log: { type: string; data: string }) => {
      console.log("[preload.ts] Received docker-logs event:", log);
      callback(log);
    };
    ipcRenderer.on("docker-logs", handler);
    return () => {
      console.log("[preload.ts] Removing docker-logs listener");
      ipcRenderer.removeListener("docker-logs", handler);
    };
  },
  clearDockerLogsListener: () => {
    ipcRenderer.removeAllListeners("docker-logs");
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
  runInitialSetup: (dataLocation: string, cloneLocation: string) =>
    ipcRenderer.invoke("run-initial-setup", dataLocation, cloneLocation),
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
    cloneLocation: string | null,
    userSelections: any,
    currentSite: string,
    parsedEnvEntries: any[],
    installationSuccess: boolean | null
  ) =>
    ipcRenderer.invoke(
      "configmanager:save-full-state",
      setupPathOrDataLocation,
      cloneLocation,
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
  // Docker-based deployment methods
  validateDockerSetup: (setupPath: string) =>
    ipcRenderer.invoke("validate-docker-setup", setupPath),
  setupDockerDeployment: (
    dataLocation: string,
    setupLocation: string,
    userConfig?: any
  ) =>
    ipcRenderer.invoke(
      "setup-docker-deployment",
      dataLocation,
      setupLocation,
      userConfig
    ),
  setupDockerDirectory: (targetDirectory: string, userConfig?: any) =>
    ipcRenderer.invoke("setup-docker-directory", targetDirectory, userConfig),
  // Docker installation check methods
  checkDockerInstallation: () =>
    ipcRenderer.invoke("check-docker-installation"),
  getDockerInstallationInstructions: () =>
    ipcRenderer.invoke("get-docker-installation-instructions"),
  onDockerInstallationCheck: (callback) => {
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
  // Auto-update methods
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  getUpdateInfo: () => ipcRenderer.invoke("get-update-info"),
  isUpdateAvailable: () => ipcRenderer.invoke("is-update-available"),
  getCurrentVersion: () => ipcRenderer.invoke("get-current-version"),
  getEnvironment: () => ipcRenderer.invoke("get-environment"),
  getSystemInfo: () => ipcRenderer.invoke("get-system-info"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  testUpdateCheck: () => ipcRenderer.invoke("test-update-check"),

  // Enhanced update methods
  enhancedCheckForUpdates: () => ipcRenderer.invoke("enhanced-check-for-updates"),
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
    const handler = (_event: any, data: { action: string; path?: string }) => callback(data);
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
};

console.log("[preload.ts] About to expose electronAPI to main world");
console.log("[preload.ts] exposedAPI keys:", Object.keys(exposedAPI));
console.log(
  "[preload.ts] stopDockerCompose type:",
  typeof exposedAPI.stopDockerCompose
);

contextBridge.exposeInMainWorld("electronAPI", exposedAPI);

console.log("[preload.ts] electronAPI exposed to main world");
console.log(
  "[preload.ts] Checking if electronAPI is available in window:",
  typeof window !== "undefined" && "electronAPI" in window
);
