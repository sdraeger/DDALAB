/**
 * Consolidated IPC handlers for DDALAB deployment management
 * Integrates configuration, Docker deployment, and update services
 */

import { setupDeploymentConfigIPC } from './deployment-config-ipc';
import { setupDeploymentUpdateIPC } from './deployment-update-ipc';
import { setupDockerDeployIPC } from './docker-deploy-ipc';
import { DeploymentConfigService } from '../services/deployment-config-service';
import { DeploymentUpdateService } from '../services/deployment-update-service';
import { DockerDeploymentService } from '../services/docker-deployment-service';
import { logger } from '../utils/logger';

export async function registerDeploymentManagementIPC(): Promise<void> {
  logger.info('Registering deployment management IPC handlers');
  
  try {
    // Initialize services
    const configService = DeploymentConfigService.getInstance();
    const updateService = DeploymentUpdateService.getInstance();
    const dockerService = DockerDeploymentService.getInstance();
    
    await configService.initialize();
    await updateService.initialize();
    await dockerService.initialize();
    
    // Register IPC handlers
    setupDeploymentConfigIPC();
    setupDeploymentUpdateIPC();
    setupDockerDeployIPC();
    
    logger.info('Deployment management IPC handlers registered successfully');
  } catch (error) {
    logger.error('Failed to register deployment management IPC:', error);
    throw error;
  }
}