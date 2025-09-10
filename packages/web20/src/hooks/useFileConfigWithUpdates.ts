import { useEffect } from 'react';
import { useFileConfig } from '@/contexts/FileConfigContext';

export function useFileConfigWithUpdates(filePath?: string, onConfigUpdate?: (config: any) => void) {
  const { config, updateConfig, resetConfig } = useFileConfig();

  useEffect(() => {
    if (onConfigUpdate) {
      onConfigUpdate(config);
    }
  }, [config, onConfigUpdate]);

  // For now, we'll just synchronize via localStorage and events
  // The actual plotting components can listen to the config changes
  useEffect(() => {
    if (filePath && config.chunkSizeSeconds) {
      // Dispatch a custom event that plot components can listen to
      window.dispatchEvent(new CustomEvent('ddalab-chunk-size-change', { 
        detail: { 
          filePath, 
          chunkSizeSeconds: config.chunkSizeSeconds 
        } 
      }));
    }
  }, [filePath, config.chunkSizeSeconds]);

  return { config, updateConfig, resetConfig };
}