"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface FileConfig {
  chunkSizeSeconds: number; // Changed from samples to seconds for consistency with plotSlice
  samplingRate: number;
  windowSize: number;
  overlap: number;
  displayMode: 'continuous' | 'chunked';
  autoScale: boolean;
  filters: {
    highPass: number | null;
    lowPass: number | null;
    notch: number | null;
  };
}

interface FileConfigContextType {
  config: FileConfig;
  updateConfig: (updates: Partial<FileConfig>) => void;
  resetConfig: () => void;
}

const defaultConfig: FileConfig = {
  chunkSizeSeconds: 10, // Default to 10 seconds to match plotSlice default
  samplingRate: 1000,
  windowSize: 5000,
  overlap: 500,
  displayMode: 'continuous',
  autoScale: true,
  filters: {
    highPass: null,
    lowPass: null,
    notch: null,
  },
};

const FileConfigContext = createContext<FileConfigContextType | undefined>(undefined);

export function FileConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<FileConfig>(() => {
    console.log('[FileConfigProvider] Initializing with default config:', defaultConfig);
    // Load from localStorage if available
    if (typeof window !== 'undefined') {
      const savedConfig = localStorage.getItem('ddalab-file-config');
      if (savedConfig) {
        try {
          const loaded = { ...defaultConfig, ...JSON.parse(savedConfig) };
          console.log('[FileConfigProvider] Loaded config from localStorage:', loaded);
          return loaded;
        } catch {
          console.log('[FileConfigProvider] Failed to parse localStorage, using default');
          return defaultConfig;
        }
      }
    }
    console.log('[FileConfigProvider] No localStorage config, using default');
    return defaultConfig;
  });

  // Persist to localStorage on config changes
  useEffect(() => {
    localStorage.setItem('ddalab-file-config', JSON.stringify(config));
    
    // Dispatch custom event for cross-window/widget synchronization
    window.dispatchEvent(new CustomEvent('ddalab-file-config-update', { 
      detail: config 
    }));
  }, [config]);

  // Listen for config updates from other windows
  useEffect(() => {
    const handleConfigUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<FileConfig>;
      setConfig(customEvent.detail);
    };

    window.addEventListener('ddalab-file-config-update', handleConfigUpdate);
    return () => {
      window.removeEventListener('ddalab-file-config-update', handleConfigUpdate);
    };
  }, []);

  const updateConfig = (updates: Partial<FileConfig>) => {
    console.log('[FileConfig] Updating config:', updates);
    setConfig(prev => {
      const newConfig = { ...prev, ...updates };
      console.log('[FileConfig] New config:', newConfig);
      return newConfig;
    });
  };

  const resetConfig = () => {
    setConfig(defaultConfig);
  };

  return (
    <FileConfigContext.Provider value={{ config, updateConfig, resetConfig }}>
      {children}
    </FileConfigContext.Provider>
  );
}

export function useFileConfig() {
  const context = useContext(FileConfigContext);
  if (!context) {
    throw new Error('useFileConfig must be used within a FileConfigProvider');
  }
  return context;
}