import { contextBridge, ipcRenderer } from "electron";

// Define the interface for the API exposed to the renderer process
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
  getEnvExampleContent: () => Promise<string | undefined>;
  parseEnvExampleWithComments: () => Promise<ParsedEnvEntry[] | undefined>;
  saveEnvConfig: (content: string) => void;
  quitApp: () => void;
  startDockerCompose: () => Promise<boolean>;
  stopDockerCompose: () => Promise<boolean>;
  getDockerStatus: () => Promise<boolean>;
  getDockerLogs: () => Promise<string>;
  onDockerLogs: (
    callback: (log: { type: string; data: string }) => void
  ) => void;
  clearDockerLogsListener: () => void;
}

// Define ParsedEnvEntry if not already globally available or imported
// For preload, it's safer to redefine or ensure it's accessible
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
  getEnvExampleContent: () =>
    ipcRenderer.invoke("installer:get-env-example-content"),
  parseEnvExampleWithComments: () =>
    ipcRenderer.invoke("installer:parse-env-example-with-comments"),
  saveEnvConfig: (content: string) =>
    ipcRenderer.send("installer:save-env-config", content),
  quitApp: () => ipcRenderer.send("installer:quit-app"),
  startDockerCompose: () => ipcRenderer.invoke("docker-compose-up"),
  stopDockerCompose: () => ipcRenderer.invoke("docker-compose-down"),
  getDockerStatus: () => ipcRenderer.invoke("get-docker-status"),
  getDockerLogs: () => ipcRenderer.invoke("get-docker-logs"),
  onDockerLogs: (callback) => {
    const listener = (event: any, log: { type: string; data: string }) =>
      callback(log);
    ipcRenderer.on("docker-logs", listener);
  },
  clearDockerLogsListener: () => {
    ipcRenderer.removeAllListeners("docker-logs");
  },
};

contextBridge.exposeInMainWorld("electronAPI", exposedAPI);
