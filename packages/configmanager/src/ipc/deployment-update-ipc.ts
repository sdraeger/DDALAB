/**
 * IPC handlers for deployment update management
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { DeploymentUpdateService, UpdateInfo } from '../services/deployment-update-service';
import { logger } from '../utils/logger';
import { getMainWindow } from '../utils/main-window';

export function setupDeploymentUpdateIPC(): void {
  const updateService = DeploymentUpdateService.getInstance();
  
  // Initialize update service
  ipcMain.handle('deployment:update:initialize', async () => {
    try {
      await updateService.initialize();
      
      // Set up event forwarding to renderer
      const forwardEvent = (eventName: string) => {
        updateService.on(eventName, (...args) => {
          const window = getMainWindow();
          if (window && !window.isDestroyed()) {
            window.webContents.send(`deployment:update:${eventName}`, ...args);
          }
        });
      };
      
      forwardEvent('update-state-changed');
      forwardEvent('update-available');
      forwardEvent('download-progress');
      forwardEvent('install-progress');
      forwardEvent('update-completed');
      forwardEvent('rollback-completed');
      
      return { success: true };
    } catch (error) {
      logger.error('Failed to initialize update service:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Check for updates
  ipcMain.handle('deployment:update:check', async () => {
    try {
      const updateInfo = await updateService.checkForUpdates();
      return { success: true, updateInfo };
    } catch (error) {
      logger.error('Failed to check for updates:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Download update
  ipcMain.handle('deployment:update:download', async (
    _event: IpcMainInvokeEvent,
    updateInfo: UpdateInfo
  ) => {
    try {
      await updateService.downloadUpdate(updateInfo);
      return { success: true };
    } catch (error) {
      logger.error('Failed to download update:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Install update
  ipcMain.handle('deployment:update:install', async () => {
    try {
      await updateService.installUpdate();
      return { success: true };
    } catch (error) {
      logger.error('Failed to install update:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Rollback to previous version
  ipcMain.handle('deployment:update:rollback', async (
    _event: IpcMainInvokeEvent,
    rollbackIndex: number = 0
  ) => {
    try {
      await updateService.rollback(rollbackIndex);
      return { success: true };
    } catch (error) {
      logger.error('Failed to rollback:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Get update state
  ipcMain.handle('deployment:update:getState', async () => {
    try {
      const state = updateService.getUpdateState();
      return { success: true, state };
    } catch (error) {
      logger.error('Failed to get update state:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Get rollback history
  ipcMain.handle('deployment:update:getRollbackHistory', async () => {
    try {
      const history = updateService.getRollbackHistory();
      return { success: true, history };
    } catch (error) {
      logger.error('Failed to get rollback history:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Configure automatic updates
  ipcMain.handle('deployment:update:configureAuto', async (
    _event: IpcMainInvokeEvent,
    enabled: boolean,
    checkInterval?: number
  ) => {
    try {
      if (enabled) {
        await updateService.initialize(); // This will start auto-checks
      } else {
        updateService.stopAutoUpdateCheck();
      }
      return { success: true };
    } catch (error) {
      logger.error('Failed to configure auto updates:', error);
      return { success: false, error: error.message };
    }
  });
  
  logger.info('Deployment update IPC handlers registered');
}