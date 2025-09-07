/**
 * IPC handlers for deployment configuration management
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { DeploymentConfigService, DeploymentConfig } from '../services/deployment-config-service';
import { logger } from '../utils/logger';

export function setupDeploymentConfigIPC(): void {
  const configService = DeploymentConfigService.getInstance();
  
  // Initialize configuration service
  ipcMain.handle('deployment:config:initialize', async () => {
    try {
      await configService.initialize();
      return { success: true };
    } catch (error) {
      logger.error('Failed to initialize deployment config:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Get current configuration
  ipcMain.handle('deployment:config:get', async () => {
    try {
      const config = configService.getConfig();
      return { success: true, config };
    } catch (error) {
      logger.error('Failed to get deployment config:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Update configuration
  ipcMain.handle('deployment:config:update', async (
    _event: IpcMainInvokeEvent,
    updates: Partial<DeploymentConfig>
  ) => {
    try {
      await configService.updateConfig(updates);
      return { success: true };
    } catch (error) {
      logger.error('Failed to update deployment config:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Create configuration backup
  ipcMain.handle('deployment:config:backup', async (
    _event: IpcMainInvokeEvent,
    reason?: string
  ) => {
    try {
      const backupPath = await configService.createBackup(reason);
      return { success: true, backupPath };
    } catch (error) {
      logger.error('Failed to create config backup:', error);
      return { success: false, error: error.message };
    }
  });
  
  // List available backups
  ipcMain.handle('deployment:config:listBackups', async () => {
    try {
      const backups = await configService.listBackups();
      return { success: true, backups };
    } catch (error) {
      logger.error('Failed to list config backups:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Restore from backup
  ipcMain.handle('deployment:config:restore', async (
    _event: IpcMainInvokeEvent,
    backupFile: string
  ) => {
    try {
      await configService.restoreFromBackup(backupFile);
      return { success: true };
    } catch (error) {
      logger.error('Failed to restore config backup:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Generate Docker environment variables
  ipcMain.handle('deployment:config:generateEnv', async () => {
    try {
      const env = configService.generateDockerEnv();
      return { success: true, env };
    } catch (error) {
      logger.error('Failed to generate Docker env:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Export docker-compose configuration
  ipcMain.handle('deployment:config:exportCompose', async () => {
    try {
      const compose = await configService.exportDockerCompose();
      return { success: true, compose };
    } catch (error) {
      logger.error('Failed to export docker-compose:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Get configuration history
  ipcMain.handle('deployment:config:getHistory', async () => {
    try {
      const history = configService.getHistory();
      return { success: true, history };
    } catch (error) {
      logger.error('Failed to get config history:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Validate configuration
  ipcMain.handle('deployment:config:validate', async (
    _event: IpcMainInvokeEvent,
    config: DeploymentConfig
  ) => {
    try {
      const errors: string[] = [];
      
      // Validate required fields
      if (!config.database.password || config.database.password === 'CHANGE_ME_IN_PRODUCTION') {
        errors.push('Database password must be changed from default');
      }
      
      if (!config.auth.jwtSecret || config.auth.jwtSecret === 'CHANGE_ME_RANDOM_32_CHAR_STRING') {
        errors.push('JWT secret must be changed from default');
      }
      
      if (config.auth.jwtSecret && config.auth.jwtSecret.length < 32) {
        errors.push('JWT secret must be at least 32 characters');
      }
      
      if (!config.storage.minio.secretKey || config.storage.minio.secretKey === 'minioadmin') {
        errors.push('MinIO secret key should be changed from default');
      }
      
      // Validate ports
      if (config.api.port < 1 || config.api.port > 65535) {
        errors.push('API port must be between 1 and 65535');
      }
      
      if (config.web.port < 1 || config.web.port > 65535) {
        errors.push('Web port must be between 1 and 65535');
      }
      
      return {
        success: errors.length === 0,
        valid: errors.length === 0,
        errors
      };
    } catch (error) {
      logger.error('Failed to validate config:', error);
      return { success: false, error: error.message };
    }
  });
  
  logger.info('Deployment config IPC handlers registered');
}