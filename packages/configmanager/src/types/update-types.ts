// Update system types following SOLID principles

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
  downloadUrl?: string;
  currentVersion?: string;
  newVersion?: string;
  fileSize?: number;
  checksum?: string;
}

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateStatus {
  status: UpdateStatusType;
  message: string;
  progress?: UpdateProgress;
  updateInfo?: UpdateInfo;
  timestamp: string;
  error?: string;
}

export type UpdateStatusType =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'installed'
  | 'error'
  | 'cancelled';

export interface UpdateResult {
  success: boolean;
  message: string;
  updateInfo?: UpdateInfo;
  error?: string;
}

// Service interfaces (SOLID: Interface Segregation Principle)
export interface IUpdateChecker {
  checkForUpdates(): Promise<UpdateResult>;
  getCurrentVersion(): string;
  isUpdateAvailable(): boolean;
  getUpdateInfo(): UpdateInfo | null;
}

export interface IUpdateDownloader {
  downloadUpdate(updateInfo: UpdateInfo): Promise<UpdateResult>;
  cancelDownload(): Promise<void>;
  getDownloadProgress(): UpdateProgress | null;
}

export interface IUpdateInstaller {
  installUpdate(): Promise<UpdateResult>;
  quitAndInstall(): Promise<void>;
  isUpdateReady(): boolean;
}

export interface IUpdateNotifier {
  onStatusChange(callback: (status: UpdateStatus) => void): () => void;
  onProgressChange(callback: (progress: UpdateProgress) => void): () => void;
  notify(status: UpdateStatus): void;
}

// Combined service interface
export interface IUpdateService extends IUpdateChecker, IUpdateDownloader, IUpdateInstaller, IUpdateNotifier {
  initialize(): Promise<void>;
  forceCheck(): Promise<UpdateResult>;
  testUpdate(): Promise<UpdateResult>;
}
