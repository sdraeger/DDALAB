import { useEffect } from 'react';
import type { ElectronAPI, UserSelections, ParsedEnvEntry } from '../utils/electron';
import { logger } from '../utils/logger-client';

export const useStatePersistence = (
  electronAPI: ElectronAPI | undefined,
  userSelections: UserSelections,
  currentSite: string,
  parsedEnvEntries: ParsedEnvEntry[],
  installationSuccess: boolean
) => {
  // Auto-save state when user selections or navigation changes
  useEffect(() => {
    const saveState = async () => {
      if (electronAPI?.saveUserState) {
        try {
          await electronAPI.saveUserState(
            userSelections,
            currentSite,
            parsedEnvEntries,
            installationSuccess
          );
        } catch (error) {
          logger.error('Failed to save user state', error);
        }
      }
    };

    // Debounce state saving to avoid excessive writes
    const timeoutId = setTimeout(saveState, 1000);
    return () => clearTimeout(timeoutId);
  }, [
    userSelections,
    currentSite,
    parsedEnvEntries,
    installationSuccess,
    electronAPI,
  ]);
};