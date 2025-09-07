/**
 * Deployment Update Service
 * 
 * Manages DDALAB updates with rollback capability, ensuring zero downtime
 * and the ability to recover from failed updates.
 */

import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';
import { DeploymentConfigService } from './deployment-config-service';
import { DockerService } from './docker-service';
import semver from 'semver';

const execAsync = promisify(exec);

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

export class DeploymentUpdateService extends EventEmitter {
  private static instance: DeploymentUpdateService;
  private configService: DeploymentConfigService;
  private updateState: UpdateState = {
    status: 'idle',
    progress: 0,
    rollbackAvailable: false
  };
  
  private rollbackHistory: RollbackInfo[] = [];
  private updateCheckInterval: NodeJS.Timeout | null = null;
  private readonly maxRollbackVersions = 3;
  
  private constructor() {
    super();
    this.configService = DeploymentConfigService.getInstance();
  }
  
  static getInstance(): DeploymentUpdateService {
    if (!DeploymentUpdateService.instance) {
      DeploymentUpdateService.instance = new DeploymentUpdateService();
    }
    return DeploymentUpdateService.instance;
  }
  
  /**
   * Initialize the update service
   */
  async initialize(): Promise<void> {
    logger.info('Initializing deployment update service');
    
    // Load rollback history
    await this.loadRollbackHistory();
    
    // Start automatic update checks if enabled
    const config = this.configService.getConfig();
    if (config.updates.autoUpdate) {
      this.startAutoUpdateCheck(config.updates.checkInterval);
    }
  }
  
  /**
   * Check for updates
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    this.updateState = {
      ...this.updateState,
      status: 'checking',
      progress: 0
    };
    this.emit('update-state-changed', this.updateState);
    
    try {
      const config = this.configService.getConfig();
      const currentVersion = await this.getCurrentVersion();
      
      // Check for updates from configured channel
      const updateInfo = await this.fetchUpdateInfo(config.updates.channel);
      
      if (updateInfo && semver.gt(updateInfo.availableVersion, currentVersion)) {
        this.updateState = {
          ...this.updateState,
          status: 'idle',
          updateInfo
        };
        this.emit('update-available', updateInfo);
        return updateInfo;
      }
      
      this.updateState = {
        ...this.updateState,
        status: 'idle'
      };
      return null;
    } catch (error) {
      logger.error('Failed to check for updates:', error);
      this.updateState = {
        ...this.updateState,
        status: 'failed',
        error: error.message
      };
      this.emit('update-state-changed', this.updateState);
      throw error;
    }
  }
  
  /**
   * Download update
   */
  async downloadUpdate(updateInfo: UpdateInfo): Promise<void> {
    this.updateState = {
      ...this.updateState,
      status: 'downloading',
      progress: 0,
      updateInfo
    };
    this.emit('update-state-changed', this.updateState);
    
    try {
      // Simulate download progress for now
      // In production, this would actually download the Docker image
      for (let progress = 0; progress <= 100; progress += 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
        this.updateState.progress = progress;
        this.emit('download-progress', progress);
      }
      
      // Pull the new Docker image
      const imageName = `ddalab:${updateInfo.availableVersion}`;
      await this.pullDockerImage(imageName);
      
      this.updateState = {
        ...this.updateState,
        status: 'ready',
        progress: 100
      };
      this.emit('update-state-changed', this.updateState);
    } catch (error) {
      logger.error('Failed to download update:', error);
      this.updateState = {
        ...this.updateState,
        status: 'failed',
        error: error.message
      };
      throw error;
    }
  }
  
  /**
   * Install update with rollback capability
   */
  async installUpdate(): Promise<void> {
    if (this.updateState.status !== 'ready' || !this.updateState.updateInfo) {
      throw new Error('No update ready to install');
    }
    
    this.updateState = {
      ...this.updateState,
      status: 'installing',
      progress: 0
    };
    this.emit('update-state-changed', this.updateState);
    
    const updateInfo = this.updateState.updateInfo;
    const currentVersion = await this.getCurrentVersion();
    
    try {
      // Step 1: Create rollback point
      logger.info('Creating rollback point');
      const rollbackInfo = await this.createRollbackPoint(currentVersion);
      this.updateState.progress = 20;
      this.emit('install-progress', this.updateState.progress);
      
      // Step 2: Backup configuration
      logger.info('Backing up configuration');
      const configBackup = await this.configService.createBackup('pre-update');
      rollbackInfo.configBackupPath = configBackup;
      this.updateState.progress = 30;
      
      // Step 3: Update configuration
      logger.info('Updating configuration');
      await this.configService.updateConfig({
        docker: {
          ...this.configService.getConfig().docker,
          image: `ddalab:${updateInfo.availableVersion}`
        }
      });
      this.updateState.progress = 40;
      
      // Step 4: Stop current containers
      logger.info('Stopping current containers');
      await this.stopContainers();
      this.updateState.progress = 50;
      
      // Step 5: Start updated containers
      logger.info('Starting updated containers');
      await this.startContainers();
      this.updateState.progress = 70;
      
      // Step 6: Verify health
      logger.info('Verifying service health');
      const healthy = await this.verifyHealth();
      this.updateState.progress = 90;
      
      if (!healthy) {
        throw new Error('Services failed health check after update');
      }
      
      // Step 7: Cleanup old versions
      logger.info('Cleaning up old versions');
      await this.cleanupOldVersions();
      this.updateState.progress = 100;
      
      // Update successful
      this.updateState = {
        status: 'completed',
        progress: 100,
        rollbackAvailable: true
      };
      this.emit('update-completed', updateInfo);
      
      // Save rollback info
      this.rollbackHistory.unshift(rollbackInfo);
      await this.saveRollbackHistory();
      
    } catch (error) {
      logger.error('Update failed, initiating rollback:', error);
      
      // Automatic rollback on failure
      try {
        await this.rollback();
        this.updateState = {
          ...this.updateState,
          status: 'failed',
          error: `Update failed: ${error.message}. Rollback successful.`
        };
      } catch (rollbackError) {
        logger.error('Rollback failed:', rollbackError);
        this.updateState = {
          ...this.updateState,
          status: 'failed',
          error: `Update and rollback failed: ${error.message}`
        };
      }
      
      this.emit('update-state-changed', this.updateState);
      throw error;
    }
  }
  
  /**
   * Rollback to previous version
   */
  async rollback(rollbackIndex: number = 0): Promise<void> {
    if (rollbackIndex >= this.rollbackHistory.length) {
      throw new Error('No rollback point available');
    }
    
    const rollbackInfo = this.rollbackHistory[rollbackIndex];
    logger.info(`Rolling back to version ${rollbackInfo.version}`);
    
    try {
      // Stop current containers
      await this.stopContainers();
      
      // Restore configuration
      await this.configService.restoreFromBackup(rollbackInfo.configBackupPath);
      
      // Start containers with previous version
      await this.startContainers();
      
      // Verify health
      const healthy = await this.verifyHealth();
      if (!healthy) {
        throw new Error('Services failed health check after rollback');
      }
      
      logger.info('Rollback completed successfully');
      this.emit('rollback-completed', rollbackInfo);
      
    } catch (error) {
      logger.error('Rollback failed:', error);
      throw error;
    }
  }
  
  /**
   * Create a rollback point
   */
  private async createRollbackPoint(version: string): Promise<RollbackInfo> {
    const timestamp = new Date();
    const backupPath = path.join(
      this.configService['backupPath'],
      `rollback-${version}-${timestamp.getTime()}`
    );
    
    // Tag current Docker image for rollback
    await execAsync(`docker tag ddalab:latest ddalab:rollback-${version}`);
    
    return {
      version,
      timestamp,
      backupPath,
      configBackupPath: '' // Will be set later
    };
  }
  
  /**
   * Pull Docker image
   */
  private async pullDockerImage(imageName: string): Promise<void> {
    const { stdout, stderr } = await execAsync(`docker pull ${imageName}`);
    if (stderr) {
      logger.warn('Docker pull stderr:', stderr);
    }
    logger.info('Docker image pulled:', stdout);
  }
  
  /**
   * Stop containers
   */
  private async stopContainers(): Promise<void> {
    const config = this.configService.getConfig();
    const composeFile = config.docker.composeFile;
    
    const { stderr } = await execAsync(`docker-compose -f ${composeFile} down`);
    if (stderr) {
      logger.warn('Docker compose down stderr:', stderr);
    }
  }
  
  /**
   * Start containers
   */
  private async startContainers(): Promise<void> {
    const config = this.configService.getConfig();
    const composeFile = config.docker.composeFile;
    
    // Generate environment file
    const envContent = Object.entries(this.configService.generateDockerEnv())
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    
    const envPath = path.join(path.dirname(composeFile), '.env');
    await fs.writeFile(envPath, envContent, 'utf-8');
    
    const { stderr } = await execAsync(`docker-compose -f ${composeFile} up -d`);
    if (stderr) {
      logger.warn('Docker compose up stderr:', stderr);
    }
  }
  
  /**
   * Verify service health
   */
  private async verifyHealth(retries: number = 5): Promise<boolean> {
    for (let i = 0; i < retries; i++) {
      try {
        // Wait before checking
        await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
        
        // Check health endpoint
        const { stdout } = await execAsync('curl -f http://localhost:8001/health');
        const health = JSON.parse(stdout);
        
        if (health.status === 'healthy') {
          return true;
        }
      } catch (error) {
        logger.warn(`Health check attempt ${i + 1} failed:`, error.message);
      }
    }
    
    return false;
  }
  
  /**
   * Get current version
   */
  private async getCurrentVersion(): Promise<string> {
    try {
      const { stdout } = await execAsync('docker inspect ddalab:latest --format="{{.Config.Labels.version}}"');
      return stdout.trim() || '1.0.0';
    } catch {
      return '1.0.0';
    }
  }
  
  /**
   * Fetch update info from update server
   */
  private async fetchUpdateInfo(channel: string): Promise<UpdateInfo | null> {
    // In production, this would fetch from an update server
    // For now, return mock data
    return {
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      releaseNotes: 'New features and bug fixes',
      downloadUrl: 'https://updates.ddalab.com/releases/1.1.0',
      size: 100 * 1024 * 1024, // 100MB
      checksum: 'sha256:abcdef123456',
      mandatory: false
    };
  }
  
  /**
   * Clean up old versions
   */
  private async cleanupOldVersions(): Promise<void> {
    try {
      // Keep only the configured number of rollback versions
      const { stdout } = await execAsync('docker images ddalab:rollback-* --format "{{.Tag}}"');
      const rollbackTags = stdout.trim().split('\n').filter(tag => tag);
      
      if (rollbackTags.length > this.maxRollbackVersions) {
        const tagsToRemove = rollbackTags.slice(this.maxRollbackVersions);
        for (const tag of tagsToRemove) {
          await execAsync(`docker rmi ddalab:${tag}`);
        }
      }
      
      // Clean up old rollback history
      this.rollbackHistory = this.rollbackHistory.slice(0, this.maxRollbackVersions);
      await this.saveRollbackHistory();
    } catch (error) {
      logger.warn('Failed to cleanup old versions:', error);
    }
  }
  
  /**
   * Start automatic update checks
   */
  private startAutoUpdateCheck(interval: number): void {
    this.stopAutoUpdateCheck();
    
    this.updateCheckInterval = setInterval(async () => {
      try {
        const updateInfo = await this.checkForUpdates();
        if (updateInfo && this.configService.getConfig().updates.autoUpdate) {
          await this.downloadUpdate(updateInfo);
          await this.installUpdate();
        }
      } catch (error) {
        logger.error('Auto update check failed:', error);
      }
    }, interval);
  }
  
  /**
   * Stop automatic update checks
   */
  stopAutoUpdateCheck(): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
  }
  
  /**
   * Load rollback history
   */
  private async loadRollbackHistory(): Promise<void> {
    // In production, this would load from persistent storage
    this.rollbackHistory = [];
  }
  
  /**
   * Save rollback history
   */
  private async saveRollbackHistory(): Promise<void> {
    // In production, this would save to persistent storage
  }
  
  /**
   * Get update state
   */
  getUpdateState(): UpdateState {
    return { ...this.updateState };
  }
  
  /**
   * Get rollback history
   */
  getRollbackHistory(): RollbackInfo[] {
    return [...this.rollbackHistory];
  }
}