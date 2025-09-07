/**
 * Type definitions for DDALAB deployment management
 */

export interface DeploymentConfig {
  version: string;
  environment: 'development' | 'staging' | 'production';
  
  api: {
    host: string;
    port: number;
    publicUrl: string;
  };
  
  web: {
    port: number;
    publicUrl: string;
  };
  
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };
  
  storage: {
    minio: {
      host: string;
      port: number;
      accessKey: string;
      secretKey: string;
      bucketName: string;
      useSSL: boolean;
    };
    dataDir: string;
    allowedDirs: string[];
  };
  
  cache: {
    redis: {
      host: string;
      port: number;
      password?: string;
      db: number;
    };
  };
  
  dda: {
    binaryPath: string;
    maxConcurrentTasks: number;
    taskTimeout: number;
  };
  
  auth: {
    mode: 'local' | 'ldap' | 'oauth';
    jwtSecret: string;
    tokenExpiration: number;
  };
  
  docker: {
    image: string;
    composeFile: string;
    networks: string[];
    volumes: Record<string, string>;
    environmentOverrides: Record<string, string>;
  };
  
  ssl: {
    enabled: boolean;
    certPath?: string;
    keyPath?: string;
    letsEncrypt?: {
      email: string;
      domains: string[];
      staging: boolean;
    };
  };
  
  updates: {
    channel: 'stable' | 'beta' | 'dev';
    checkInterval: number;
    autoUpdate: boolean;
    autoBackup: boolean;
  };
}

export interface UpdateInfo {
  currentVersion: string;
  availableVersion: string;
  releaseNotes: string;
  downloadUrl: string;
  size: number;
  checksum: string;
  mandatory: boolean;
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'failed' | 'completed';
  progress: number;
  error?: string;
  updateInfo?: UpdateInfo;
  rollbackAvailable: boolean;
}

export interface RollbackInfo {
  version: string;
  timestamp: Date;
  backupPath: string;
  configBackupPath: string;
}

export interface ServiceHealth {
  service: string;
  status: 'healthy' | 'unhealthy' | 'starting' | 'stopped';
  message?: string;
  lastCheck: Date;
}

export interface DeploymentStatus {
  status: 'stopped' | 'starting' | 'running' | 'error' | 'updating';
  services: Record<string, ServiceHealth>;
  error?: string;
}

export interface ConfigBackup {
  file: string;
  timestamp: Date;
  reason: string;
}

export interface DeploymentResult {
  success: boolean;
  error?: string;
}

export interface LogStreamOptions {
  service?: string;
  lines?: number;
  follow?: boolean;
}

export interface DeploymentAPI {
  // Configuration management
  config: {
    get: () => Promise<{ success: boolean; config?: DeploymentConfig; error?: string }>;
    update: (updates: Partial<DeploymentConfig>) => Promise<DeploymentResult>;
    validate: (config: DeploymentConfig) => Promise<{ success: boolean; valid?: boolean; errors?: string[] }>;
    backup: (reason?: string) => Promise<{ success: boolean; backupPath?: string; error?: string }>;
    restore: (backupFile: string) => Promise<DeploymentResult>;
    listBackups: () => Promise<{ success: boolean; backups?: ConfigBackup[]; error?: string }>;
    generateEnv: () => Promise<{ success: boolean; env?: Record<string, string>; error?: string }>;
    exportCompose: () => Promise<{ success: boolean; compose?: string; error?: string }>;
    getHistory: () => Promise<{ success: boolean; history?: Array<{ timestamp: Date; config: DeploymentConfig }>; error?: string }>;
  };
  
  // Docker deployment operations
  docker: {
    deploy: () => Promise<DeploymentResult>;
    stop: () => Promise<DeploymentResult>;
    restart: () => Promise<DeploymentResult>;
    getStatus: () => Promise<{ success: boolean; status?: DeploymentStatus; error?: string }>;
    getLogs: (service?: string, lines?: number) => Promise<{ success: boolean; logs?: string; error?: string }>;
    getHealth: () => Promise<{ success: boolean; services?: Record<string, ServiceHealth>; error?: string }>;
    exec: (service: string, command: string[]) => Promise<{ success: boolean; output?: string; error?: string }>;
    generateCompose: () => Promise<{ success: boolean; composePath?: string; error?: string }>;
    updateConfig: (updates: Partial<DeploymentConfig>) => Promise<DeploymentResult>;
  };
  
  // Update management
  update: {
    check: () => Promise<{ success: boolean; updateInfo?: UpdateInfo | null; error?: string }>;
    download: (updateInfo: UpdateInfo) => Promise<DeploymentResult>;
    install: () => Promise<DeploymentResult>;
    rollback: (rollbackIndex?: number) => Promise<DeploymentResult>;
    getState: () => Promise<{ success: boolean; state?: UpdateState; error?: string }>;
    getRollbackHistory: () => Promise<{ success: boolean; history?: RollbackInfo[]; error?: string }>;
    configureAuto: (enabled: boolean, checkInterval?: number) => Promise<DeploymentResult>;
  };
  
  // Event listeners
  on: (event: string, callback: (...args: any[]) => void) => void;
  off: (event: string, callback: (...args: any[]) => void) => void;
}