/**
 * IPC handlers for Docker deployment operations
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { DockerDeploymentService } from '../services/docker-deployment-service';
import { DeploymentConfig } from '../services/deployment-config-service';
import { logger } from '../utils/logger';
import { getMainWindow } from '../utils/main-window';

export function setupDockerDeployIPC(): void {
  const dockerService = DockerDeploymentService.getInstance();
  
  // Initialize Docker deployment service
  ipcMain.handle('docker:deploy:initialize', async () => {
    try {
      await dockerService.initialize();
      
      // Set up event forwarding to renderer
      const forwardEvent = (eventName: string) => {
        dockerService.on(eventName, (...args) => {
          const window = getMainWindow();
          if (window && !window.isDestroyed()) {
            window.webContents.send(`docker:deploy:${eventName}`, ...args);
          }
        });
      };
      
      forwardEvent('deployment-status-changed');
      forwardEvent('deployment-output');
      forwardEvent('health-status-changed');
      
      return { success: true };
    } catch (error) {
      logger.error('Failed to initialize Docker deployment:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Deploy DDALAB
  ipcMain.handle('docker:deploy:start', async () => {
    try {
      await dockerService.deploy();
      return { success: true };
    } catch (error) {
      logger.error('Failed to deploy DDALAB:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Stop deployment
  ipcMain.handle('docker:deploy:stop', async () => {
    try {
      await dockerService.stop();
      return { success: true };
    } catch (error) {
      logger.error('Failed to stop deployment:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Restart deployment
  ipcMain.handle('docker:deploy:restart', async () => {
    try {
      await dockerService.restart();
      return { success: true };
    } catch (error) {
      logger.error('Failed to restart deployment:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Update deployment configuration
  ipcMain.handle('docker:deploy:updateConfig', async (
    _event: IpcMainInvokeEvent,
    updates: Partial<DeploymentConfig>
  ) => {
    try {
      await dockerService.updateConfiguration(updates);
      return { success: true };
    } catch (error) {
      logger.error('Failed to update deployment config:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Get deployment status
  ipcMain.handle('docker:deploy:getStatus', async () => {
    try {
      const status = await dockerService.checkDeploymentStatus();
      return { success: true, status };
    } catch (error) {
      logger.error('Failed to get deployment status:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Get logs
  ipcMain.handle('docker:deploy:getLogs', async (
    _event: IpcMainInvokeEvent,
    service?: string,
    lines: number = 100
  ) => {
    try {
      const logs = await dockerService.getLogs(service, lines);
      return { success: true, logs };
    } catch (error) {
      logger.error('Failed to get logs:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Execute command in container
  ipcMain.handle('docker:deploy:exec', async (
    _event: IpcMainInvokeEvent,
    service: string,
    command: string[]
  ) => {
    try {
      const output = await dockerService.exec(service, command);
      return { success: true, output };
    } catch (error) {
      logger.error('Failed to execute command:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Generate docker-compose file
  ipcMain.handle('docker:deploy:generateCompose', async () => {
    try {
      const composePath = await dockerService.generateDockerCompose();
      return { success: true, composePath };
    } catch (error) {
      logger.error('Failed to generate docker-compose:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Get service health
  ipcMain.handle('docker:deploy:getHealth', async () => {
    try {
      const status = dockerService.getDeploymentStatus();
      return { success: true, services: status.services };
    } catch (error) {
      logger.error('Failed to get service health:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Stream logs (for real-time log viewing)
  ipcMain.handle('docker:deploy:streamLogs', async (
    event: IpcMainInvokeEvent,
    service?: string
  ) => {
    try {
      const { spawn } = require('child_process');
      const args = ['logs', '-f'];
      if (service) args.push(service);
      
      const proc = spawn('docker-compose', args, {
        cwd: process.env.HOME + '/.ddalab/deployment'
      });
      
      proc.stdout.on('data', (data: Buffer) => {
        event.sender.send('docker:deploy:log-data', {
          type: 'stdout',
          data: data.toString(),
          service
        });
      });
      
      proc.stderr.on('data', (data: Buffer) => {
        event.sender.send('docker:deploy:log-data', {
          type: 'stderr',
          data: data.toString(),
          service
        });
      });
      
      // Store process ID to allow stopping
      const processId = proc.pid;
      
      // Handle cleanup
      event.sender.once('docker:deploy:stop-stream', () => {
        proc.kill();
      });
      
      return { success: true, processId };
    } catch (error) {
      logger.error('Failed to stream logs:', error);
      return { success: false, error: error.message };
    }
  });
  
  logger.info('Docker deployment IPC handlers registered');
}