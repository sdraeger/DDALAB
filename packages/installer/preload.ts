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
    ipcRenderer.on("all-services-ready", handler);
    return () => {
      ipcRenderer.removeListener("all-services-ready", handler);
    };
  },
  getEnvDetails: (envPath: string) =>
    ipcRenderer.invoke("get-env-details", envPath),
  saveEnvFile: (envPath: string, envData: Record<string, string>) =>
    ipcRenderer.invoke("save-env-file", envPath, envData),
};

contextBridge.exposeInMainWorld("electronAPI", exposedAPI);
