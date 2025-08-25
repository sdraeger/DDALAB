import { useCallback } from 'react';
import type { ElectronAPI, ParsedEnvEntry } from '../utils/electron';
import { logger } from '../utils/logger-client';

interface EnvironmentLoaderReturn {
  loadEnvVars: (path: string) => Promise<ParsedEnvEntry[] | null>;
}

export const useEnvironmentLoader = (
  electronAPI: ElectronAPI | undefined,
  updateSelections: (selections: any) => void,
  updateEnvEntries: (entries: ParsedEnvEntry[]) => void
): EnvironmentLoaderReturn => {
  const loadEnvVars = useCallback(
    async (path: string): Promise<ParsedEnvEntry[] | null> => {
      if (!electronAPI?.loadEnvVars) return null;
      try {
        const entries = await electronAPI.loadEnvVars(path);
        if (!entries) return null;
        updateSelections({
          envVariables: Object.fromEntries(
            entries.map(({ key, value }) => [key, value])
          ),
        });
        updateEnvEntries(entries);
        return entries;
      } catch (error) {
        logger.error('Could not load environment variables', error);
        return null;
      }
    },
    [electronAPI, updateSelections, updateEnvEntries]
  );

  return {
    loadEnvVars,
  };
};