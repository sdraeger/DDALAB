import React, { useEffect } from 'react';
import type { ElectronAPI, UserSelections, ParsedEnvEntry } from '../utils/electron';
import { logger } from '../utils/logger-client';

interface MenuActionHandlerProps {
  electronAPI: ElectronAPI | undefined;
  userSelections: UserSelections;
  goToSite: (site: string) => void;
  updateSelections: (selections: Partial<UserSelections>) => void;
  updateEnvEntries: (entries: ParsedEnvEntry[]) => void;
  setInstallationSuccess: (success: boolean) => void;
  validateDockerSetup: (path: string) => Promise<boolean>;
}

export const MenuActionHandler: React.FC<MenuActionHandlerProps> = ({
  electronAPI,
  userSelections,
  goToSite,
  updateSelections,
  updateEnvEntries,
  setInstallationSuccess,
  validateDockerSetup,
}) => {
  useEffect(() => {
    const handleMenuAction = (data: { action: string; path?: string }) => {
      switch (data.action) {
        case 'new-setup':
          goToSite('welcome');
          updateSelections({});
          updateEnvEntries([]);
          setInstallationSuccess(false);
          break;
        case 'open-setup-directory':
          if (data.path) {
            updateSelections({
              dataLocation: data.path,
              projectLocation: data.path,
            });
          }
          break;
        case 'restart-setup-wizard':
          goToSite('welcome');
          break;
        case 'reset-all-settings':
          goToSite('welcome');
          updateSelections({});
          updateEnvEntries([]);
          setInstallationSuccess(false);
          break;
        case 'validate-current-setup':
          if (electronAPI?.validateDockerSetup && userSelections.dataLocation) {
            validateDockerSetup(userSelections.dataLocation);
          }
          break;
        case 'start-docker-services':
          if (electronAPI?.startMonolithicDocker) {
            electronAPI.startMonolithicDocker();
          }
          break;
        case 'stop-docker-services':
          if (electronAPI?.stopMonolithicDocker) {
            electronAPI.stopMonolithicDocker(false);
          }
          break;
        case 'restart-docker-services':
          if (
            electronAPI?.stopMonolithicDocker &&
            electronAPI?.startMonolithicDocker
          ) {
            electronAPI.stopMonolithicDocker(false).then(() => {
              setTimeout(() => electronAPI.startMonolithicDocker(), 2000);
            });
          }
          break;
        case 'check-docker-status':
          if (electronAPI?.getDockerStatus) {
            electronAPI.getDockerStatus();
          }
          break;
        case 'view-docker-logs':
          goToSite('control-panel');
          break;
        case 'reset-docker-volumes':
          if (electronAPI?.stopMonolithicDocker) {
            electronAPI.stopMonolithicDocker(true);
          }
          break;
        case 'export-configuration':
        case 'import-configuration':
          // These are handled by menu IPC handlers
          break;
        default:
          logger.warn('Unhandled menu action', { action: data.action });
      }
    };

    if (electronAPI?.onMenuAction) {
      const removeMenuListener = electronAPI.onMenuAction(handleMenuAction);
      return () => {
        removeMenuListener();
      };
    }
  }, [
    electronAPI,
    goToSite,
    updateSelections,
    updateEnvEntries,
    setInstallationSuccess,
    userSelections.dataLocation,
    validateDockerSetup,
  ]);

  return null;
};