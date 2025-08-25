import { useCallback } from 'react';
import { useSiteNavigation } from './useSiteNavigation';
import { logger } from '../utils/logger-client';

interface NavigationHandlers {
  handleNavigation: (direction: 'next' | 'back') => Promise<void>;
  validateDockerSetup: (path: string) => Promise<boolean>;
  executeDockerInstallation: () => Promise<boolean>;
}

export const useAppNavigation = (
  electronAPI: any,
  setIsSetupComplete: (value: boolean) => void
): NavigationHandlers => {
  const {
    currentSite,
    userSelections,
    parsedEnvEntries,
    installationSuccess,
    goToNextSite,
    goToPreviousSite,
    updateSelections,
    setInstallationSuccess,
  } = useSiteNavigation();

  const validateDockerSetup = useCallback(
    async (path: string): Promise<boolean> => {
      if (!electronAPI || !path) {
        logger.error('Setup validation not available or no directory selected');
        return false;
      }
      try {
        const result = await electronAPI.validateDockerSetup(path);
        if (result.success) {
          updateSelections({
            dataLocation: path,
            projectLocation: path,
          });
          return true;
        }
        if (result.needsSetup && result.targetPath) {
          // Return false to trigger setup dialog in parent component
          return false;
        } else {
          logger.error('Docker setup validation failed', result.message || 'Failed to validate Docker setup directory');
        }
        return false;
      } catch (error) {
        logger.error('Failed to validate Docker setup', error);
        return false;
      }
    },
    [electronAPI, updateSelections]
  );

  const executeDockerInstallation = useCallback(async (): Promise<boolean> => {
    if (!electronAPI || !userSelections.dataLocation) {
      logger.error('Installation interface not available or no directory selected');
      return false;
    }
    try {
      if (userSelections.setupType === 'docker') {
        if (!userSelections.projectLocation) {
          logger.error('Setup location not selected for Docker setup');
          return false;
        }

        // Build the user configuration from selections
        const userConfig = {
          dataLocation: userSelections.dataLocation,
          allowedDirs: userSelections.envVariables?.DDALAB_ALLOWED_DIRS || `${userSelections.dataLocation}:/app/data:rw`,
          webPort: userSelections.envVariables?.WEB_PORT || '3000',
          apiPort: userSelections.envVariables?.DDALAB_API_PORT || '8001',
          apiPortMetrics: userSelections.envVariables?.API_PORT_METRICS || '8002',
          dbPassword: userSelections.envVariables?.DDALAB_DB_PASSWORD || 'ddalab_password',
          minioPassword: userSelections.envVariables?.MINIO_ROOT_PASSWORD || 'ddalab_password',
          traefikEmail: userSelections.envVariables?.TRAEFIK_ACME_EMAIL || 'admin@ddalab.local',
          useDockerHub: true,
          authMode: userSelections.envVariables?.DDALAB_AUTH_MODE || 'local',
          projectLocation: userSelections.projectLocation,
        };

        await electronAPI.setupDockerDeployment(
          userSelections.dataLocation,
          userSelections.projectLocation,
          userConfig
        );
      } else {
        await electronAPI.saveEnvFile(
          userSelections.dataLocation,
          userSelections.envVariables
        );
        await electronAPI.markSetupComplete(userSelections.dataLocation);
      }

      if (electronAPI?.saveFullState) {
        await electronAPI.saveFullState(
          userSelections.dataLocation,
          userSelections.projectLocation,
          userSelections,
          currentSite,
          parsedEnvEntries,
          installationSuccess
        );
      }

      setInstallationSuccess(true);
      return true;
    } catch (error) {
      logger.error('Installation failed', error);
      return false;
    }
  }, [
    electronAPI,
    userSelections,
    currentSite,
    parsedEnvEntries,
    installationSuccess,
    setInstallationSuccess,
  ]);

  const handleNavigation = useCallback(
    async (direction: 'next' | 'back') => {
      if (direction === 'back') {
        goToPreviousSite();
        return;
      }

      try {
        let canProceed = true;
        switch (currentSite) {
          case 'welcome':
            if (!userSelections.setupType) {
              logger.warn('Please select a setup type');
              canProceed = false;
            } else if (userSelections.setupType === 'docker') {
              updateSelections({ envVariables: {} });
            }
            break;
          case 'data-location':
            if (!userSelections.dataLocation) {
              logger.warn('Please select a data location');
              canProceed = false;
            } else if (!userSelections.envVariables?.DDALAB_ALLOWED_DIRS) {
              logger.warn('Please configure allowed directories before proceeding');
              canProceed = false;
            }
            break;
          case 'clone-location':
            if (!userSelections.projectLocation) {
              logger.warn('Please select a setup location');
              canProceed = false;
            }
            break;
          case 'docker-config':
            if (!userSelections.dataLocation || !userSelections.projectLocation) {
              logger.warn('Please complete the previous steps first');
              canProceed = false;
            }
            break;
          case 'manual-config':
            canProceed = await validateDockerSetup(userSelections.dataLocation);
            break;
          case 'summary':
            canProceed = await executeDockerInstallation();
            if (canProceed) {
              setIsSetupComplete(true);
            }
            break;
        }
        if (canProceed) goToNextSite();
      } catch (error) {
        logger.error('An error occurred during navigation', error);
      }
    },
    [
      currentSite,
      userSelections,
      goToNextSite,
      goToPreviousSite,
      updateSelections,
      validateDockerSetup,
      executeDockerInstallation,
      setIsSetupComplete,
    ]
  );

  return {
    handleNavigation,
    validateDockerSetup,
    executeDockerInstallation,
  };
};