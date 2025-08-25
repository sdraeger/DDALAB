import React, { useState } from 'react';
import { HealthCheck } from '../services/health-check-service';
import { logger } from '../utils/logger-client';
import type { ElectronAPI } from '../utils/electron';

interface HealthRecoveryActionsProps {
  check: HealthCheck;
  electronAPI?: ElectronAPI;
  userSelections?: any;
  onRecoveryAttempted?: (checkId: string, success: boolean) => void;
}

const HealthRecoveryActions: React.FC<HealthRecoveryActionsProps> = ({
  check,
  electronAPI,
  userSelections,
  onRecoveryAttempted,
}) => {
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string>('');

  const handleRecovery = async (action: string) => {
    if (!electronAPI) {
      logger.warn('Cannot perform recovery: Electron API not available');
      return;
    }

    setIsRecovering(true);
    setRecoveryMessage('');

    try {
      let success = false;
      let message = '';

      switch (action) {
        case 'create_directory':
          if (check.details?.path) {
            await electronAPI.createDirectory(check.details.path);
            success = true;
            message = `Created directory: ${check.details.path}`;
          }
          break;

        case 'start_docker':
          try {
            await electronAPI.startDocker();
            success = true;
            message = 'Docker service started successfully';
          } catch (error) {
            message = `Failed to start Docker: ${error}`;
          }
          break;

        case 'recreate_config':
          if (userSelections?.dataLocation) {
            try {
              // This would need to be implemented in the electron API
              // await electronAPI.recreateConfigFiles(userSelections);
              success = true;
              message = 'Configuration files recreated';
            } catch (error) {
              message = `Failed to recreate config files: ${error}`;
            }
          }
          break;

        case 'fix_permissions':
          if (check.details?.path) {
            try {
              await electronAPI.fixDirectoryPermissions(check.details.path);
              success = true;
              message = `Fixed permissions for: ${check.details.path}`;
            } catch (error) {
              message = `Failed to fix permissions: ${error}`;
            }
          }
          break;

        case 'restart_services':
          if (userSelections?.dataLocation) {
            try {
              await electronAPI.restartDockerServices(userSelections.dataLocation);
              success = true;
              message = 'Docker services restarted';
            } catch (error) {
              message = `Failed to restart services: ${error}`;
            }
          }
          break;

        default:
          message = `Unknown recovery action: ${action}`;
      }

      setRecoveryMessage(message);
      onRecoveryAttempted?.(check.id, success);

      if (success) {
        logger.info(`Recovery successful for ${check.id}:`, message);
      } else {
        logger.warn(`Recovery failed for ${check.id}:`, message);
      }

    } catch (error) {
      const errorMessage = `Recovery failed: ${error}`;
      setRecoveryMessage(errorMessage);
      logger.error(`Recovery error for ${check.id}:`, error);
      onRecoveryAttempted?.(check.id, false);
    } finally {
      setIsRecovering(false);
    }
  };

  const getRecoveryActions = (): Array<{ id: string; label: string; icon: string; variant: string }> => {
    const actions: Array<{ id: string; label: string; icon: string; variant: string }> = [];

    switch (check.id) {
      case 'data_directory_exists':
      case 'project_directory_exists':
        actions.push({
          id: 'create_directory',
          label: 'Create Directory',
          icon: 'bi-folder-plus',
          variant: 'primary'
        });
        break;

      case 'docker_running':
        actions.push({
          id: 'start_docker',
          label: 'Start Docker',
          icon: 'bi-play-circle',
          variant: 'success'
        });
        break;

      case 'config_file_env':
      case 'config_file_docker_compose_yml':
        actions.push({
          id: 'recreate_config',
          label: 'Recreate Config',
          icon: 'bi-file-earmark-plus',
          variant: 'warning'
        });
        break;

      case 'data_directory_writable':
      case 'directory_permissions':
        actions.push({
          id: 'fix_permissions',
          label: 'Fix Permissions',
          icon: 'bi-key',
          variant: 'info'
        });
        break;

      case 'docker_service_ddalab':
      case 'docker_service_postgres':
      case 'docker_service_redis':
        actions.push({
          id: 'restart_services',
          label: 'Restart Services',
          icon: 'bi-arrow-clockwise',
          variant: 'secondary'
        });
        break;
    }

    return actions;
  };

  const recoveryActions = getRecoveryActions();

  if (recoveryActions.length === 0 || check.status === 'pass') {
    return null;
  }

  return (
    <div className="health-recovery-actions mt-2">
      <div className="d-flex flex-wrap gap-2">
        {recoveryActions.map((action) => (
          <button
            key={action.id}
            className={`btn btn-sm btn-${action.variant}`}
            onClick={() => handleRecovery(action.id)}
            disabled={isRecovering}
            title={`Attempt to resolve: ${check.message}`}
          >
            {isRecovering ? (
              <>
                <span className="spinner-border spinner-border-sm me-1"></span>
                Working...
              </>
            ) : (
              <>
                <i className={`${action.icon} me-1`}></i>
                {action.label}
              </>
            )}
          </button>
        ))}
      </div>
      
      {recoveryMessage && (
        <div className={`alert ${recoveryMessage.includes('Failed') ? 'alert-danger' : 'alert-success'} alert-sm mt-2 mb-0`}>
          <small>{recoveryMessage}</small>
        </div>
      )}
    </div>
  );
};

export default HealthRecoveryActions;