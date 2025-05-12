import { contextBridge, ipcRenderer } from "electron";

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
  getDockerLogs: () => Promise<string>;
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
  runInitialSetup: (allowedDirsValue: string) => Promise<{
    success: boolean;
    message: string;
    setupPath?: string;
  }>;
  getInstallerState: () => Promise<{
    setupComplete: boolean;
    setupPath: string | null;
    error?: boolean;
  }>;
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
  markSetupComplete: (manualSetupDirectory?: string) => Promise<{
    success: boolean;
    message?: string;
    finalSetupPath: string | null;
  }>;
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
  selectDirectory: () => ipcRenderer.invoke("installer:select-directory"),
  loadEnvVars: (dataDir?: string) =>
    ipcRenderer.invoke("installer:load-env-vars", dataDir),
  saveEnvConfig: (targetDir: string | null, content: string) =>
    ipcRenderer.send("installer:save-env-config", targetDir, content),
  quitApp: () => ipcRenderer.send("installer:quit-app"),
  startDockerCompose: () => ipcRenderer.invoke("start-docker-compose"),
  stopDockerCompose: (deleteVolumes?: boolean) =>
    ipcRenderer.invoke("docker-compose-down", deleteVolumes),
  getDockerStatus: () => ipcRenderer.invoke("get-docker-status"),
  getDockerLogs: () => ipcRenderer.invoke("get-docker-logs"),
  onDockerLogs: (callback) => {
    const handler = (_event: any, log: { type: string; data: string }) =>
      callback(log);
    ipcRenderer.on("docker-log-stream", handler);
    return () => {
      ipcRenderer.removeListener("docker-log-stream", handler);
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
  runInitialSetup: (allowedDirsValue: string) =>
    ipcRenderer.invoke("run-initial-setup", allowedDirsValue),
  getInstallerState: () => ipcRenderer.invoke("get-installer-state"),
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
  markSetupComplete: (manualSetupDirectory?: string) =>
    ipcRenderer.invoke("mark-setup-complete", manualSetupDirectory),
};

contextBridge.exposeInMainWorld("electronAPI", exposedAPI);
