export function getFormattedCommentsHtml(comments: string[]): string {
  if (!comments || comments.length === 0) {
    return "<p><em>No description provided.</em></p>";
  }
  return comments
    .map((comment) => {
      let processedComment = comment;
      processedComment = processedComment.replace(
        /\*\*(.*?)\*\*/g,
        "<strong>$1</strong>"
      );
      processedComment = processedComment.replace(/__(.*?)__/g, "<em>$1</em>");
      processedComment = processedComment.replace(
        /\*([^\s*][^\*]*?)\*/g,
        "<strong>$1</strong>"
      );
      processedComment = processedComment.replace(
        /_([^\s_][^_]*?)_/g,
        "<em>$1</em>"
      );
      return processedComment;
    })
    .join("<br />");
}

export function formatTimestamp(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
}

// Interface for parsed .env entries (from renderer.ts)
export interface ParsedEnvEntry {
  key: string;
  value: string;
  comments: string[];
}

// User Selections (from renderer.ts)
export interface UserSelections {
  setupType: "" | "automatic" | "manual" | "docker";
  dataLocation: string;
  cloneLocation: string;
  envVariables: { [key: string]: string };
  // Docker configuration fields
  webPort?: string;
  apiPort?: string;
  dbPassword?: string;
  minioPassword?: string;
  traefikEmail?: string;
  useDockerHub?: boolean;
  authMode?: string;
  // Potentially add other state installer might need, e.g. installationLog
  installationLog?: string[];
}

// Electron API (from preload - ensure this matches your preload.ts definition)
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
    setupPath: string | undefined;
    dataLocation?: string;
    cloneLocation?: string;
    error?: boolean;
  }>;
  onSetupProgress: (
    callback: (progress: { message: string; type?: string }) => void
  ) => () => void;
  onSetupFinished: (
    callback: (state: {
      setupComplete: boolean;
      setupPath: string | undefined;
    }) => void
  ) => () => void;
  // Listeners for Control Panel (matching preload.ts)
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
    setupPath: string | undefined;
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
  saveEnvFile: (
    envPath: string,
    envData: Record<string, string>
  ) => Promise<void>;
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
    setupLocation: string,
    userConfig?: any
  ) => Promise<{
    success: boolean;
    message: string;
    setupPath?: string;
  }>;
  setupDockerDirectory: (
    targetDirectory: string,
    userConfig?: any
  ) => Promise<{
    success: boolean;
    message: string;
    setupPath?: string;
  }>;
}

// This declares the shape of window.electronAPI for TypeScript
// Ensure this is the single source of truth for this augmentation in your renderer process code.
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
