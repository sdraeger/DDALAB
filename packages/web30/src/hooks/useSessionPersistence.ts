"use client";

import { useEffect, useCallback, useState } from 'react';
import { statePersistenceService, DashboardSession } from '@/services/StatePersistenceService';

export function useSessionPersistence() {
  const [session, setSession] = useState<DashboardSession>(() => 
    statePersistenceService.getSessionState()
  );
  const [isLoaded, setIsLoaded] = useState(false);

  // Update session and persist
  const updateSession = useCallback((updates: Partial<DashboardSession>) => {
    setSession(prev => {
      const newSession = { ...prev, ...updates };
      statePersistenceService.scheduleAutoSave(updates);
      return newSession;
    });
  }, []);

  // File manager state helpers
  const updateFileManagerState = useCallback((updates: Partial<DashboardSession['fileManager']>) => {
    console.log('🔧 updateFileManagerState called with:', updates);
    setSession(prev => {
      const newFileManager = { ...prev.fileManager, ...updates };
      console.log('🔧 New fileManager state:', newFileManager);
      statePersistenceService.updateFileManagerState(updates);
      return { ...prev, fileManager: newFileManager };
    });
  }, []);

  // UI element helpers
  const saveUIElement = useCallback((
    elementId: string, 
    type: 'plot' | 'form' | 'panel' | 'widget', 
    lightweightState: Record<string, any>
  ) => {
    statePersistenceService.saveUIElementReference(elementId, type, lightweightState);
    
    setSession(prev => {
      const updatedElements = prev.uiElements
        .filter(el => el.id !== elementId)
        .concat({
          id: elementId,
          type,
          lightweightState,
          timestamp: Date.now()
        });
      
      return { ...prev, uiElements: updatedElements };
    });
  }, []);

  const getUIElement = useCallback((elementId: string) => {
    return statePersistenceService.getUIElementReference(elementId);
  }, []);

  // Tab and panel helpers
  const updateActiveTab = useCallback((tab: string) => {
    setSession(prev => ({ ...prev, activeTab: tab }));
    statePersistenceService.updateActiveTab(tab);
  }, []);

  const updatePanelSizes = useCallback((sizes: number[]) => {
    setSession(prev => ({ ...prev, panelSizes: sizes }));
    statePersistenceService.updatePanelSizes(sizes);
  }, []);

  const updatePreferences = useCallback((preferences: Record<string, any>) => {
    setSession(prev => ({
      ...prev,
      preferences: { ...prev.preferences, ...preferences }
    }));
    statePersistenceService.updatePreferences(preferences);
  }, []);

  // Clear session
  const clearSession = useCallback(() => {
    statePersistenceService.clearSession();
    setSession(statePersistenceService.getSessionState());
  }, []);

  // Load persisted session on mount (lightweight only)
  useEffect(() => {
    const persistedSession = statePersistenceService.getSessionState();
    setSession(persistedSession);
    setIsLoaded(true);
    console.log('🔄 Loaded persisted session on mount:', persistedSession);
  }, []); // Empty dependency array ensures this only runs once on mount

  // Cleanup old references periodically
  useEffect(() => {
    const cleanup = () => statePersistenceService.cleanupOldReferences();
    const interval = setInterval(cleanup, 5 * 60 * 1000); // Every 5 minutes
    
    return () => clearInterval(interval);
  }, []);

  return {
    session,
    isLoaded,
    updateSession,
    updateFileManagerState,
    saveUIElement,
    getUIElement,
    updateActiveTab,
    updatePanelSizes,
    updatePreferences,
    clearSession
  };
}

export function useFileManagerPersistence(session: ReturnType<typeof useSessionPersistence>['session'], updateFileManagerState: ReturnType<typeof useSessionPersistence>['updateFileManagerState']) {
  // Always require both parameters to avoid multiple hook instances
  
  const selectFile = useCallback((fileId: string | null) => {
    console.log('🔄 selectFile called with:', fileId);
    updateFileManagerState({ selectedFileId: fileId });
    console.log('💾 File saved to persistence');
  }, [updateFileManagerState]);

  const selectChannels = useCallback((channelIds: string[]) => {
    console.log('🔄 selectChannels called with:', channelIds);
    // Always update the current state, but mark empty selections for special handling
    updateFileManagerState({ 
      selectedChannelIds: channelIds,
      hasEmptyChannelSelection: channelIds.length === 0
    });
    console.log('💾 Channels saved to persistence');
  }, [updateFileManagerState]);

  const updateFilters = useCallback((filterIds: string[]) => {
    updateFileManagerState({ activeFilters: filterIds });
  }, [updateFileManagerState]);

  const updateTimeWindow = useCallback((timeWindow: { start: number; end: number }) => {
    updateFileManagerState({ timeWindow });
  }, [updateFileManagerState]);

  const toggleFolder = useCallback((folderId: string) => {
    const currentExpanded = session?.fileManager?.expandedFolders || [];
    const newExpanded = currentExpanded.includes(folderId)
      ? currentExpanded.filter(id => id !== folderId)
      : [...currentExpanded, folderId];
    
    updateFileManagerState({ expandedFolders: newExpanded });
  }, [session?.fileManager?.expandedFolders, updateFileManagerState]);

  const updateSort = useCallback((sortBy: string, sortOrder: 'asc' | 'desc') => {
    updateFileManagerState({ sortBy, sortOrder });
  }, [updateFileManagerState]);

  return {
    fileManager: session?.fileManager || {
      selectedFileId: null,
      selectedChannelIds: [],
      hasEmptyChannelSelection: false,
      activeFilters: [],
      timeWindow: { start: 0, end: 30 },
      expandedFolders: [],
      sortBy: 'name',
      sortOrder: 'asc' as const
    },
    selectFile,
    selectChannels,
    updateFilters,
    updateTimeWindow,
    toggleFolder,
    updateSort
  };
}

export function useFormPersistence(formId: string, saveUIElement: ReturnType<typeof useSessionPersistence>['saveUIElement'], getUIElement: ReturnType<typeof useSessionPersistence>['getUIElement']) {
  
  const [formState, setFormState] = useState<Record<string, any>>(() => {
    const saved = getUIElement(formId);
    return saved?.lightweightState || {};
  });

  const updateField = useCallback((fieldName: string, value: any) => {
    setFormState(prev => {
      const newState = { ...prev, [fieldName]: value };
      saveUIElement(formId, 'form', newState);
      return newState;
    });
  }, [formId, saveUIElement]);

  const updateFields = useCallback((fields: Record<string, any>) => {
    setFormState(prev => {
      const newState = { ...prev, ...fields };
      saveUIElement(formId, 'form', newState);
      return newState;
    });
  }, [formId, saveUIElement]);

  const resetForm = useCallback(() => {
    setFormState({});
    saveUIElement(formId, 'form', {});
  }, [formId, saveUIElement]);

  return {
    formState,
    updateField,
    updateFields,
    resetForm
  };
}

export function usePlotPersistence(plotId: string, saveUIElement: ReturnType<typeof useSessionPersistence>['saveUIElement'], getUIElement: ReturnType<typeof useSessionPersistence>['getUIElement']) {
  
  const [plotState, setPlotState] = useState(() => {
    const saved = getUIElement(plotId);
    return saved?.lightweightState || {
      zoom: { x: [0, 100], y: [0, 100] },
      pan: { x: 0, y: 0 },
      channelIds: [],
      timeRange: { start: 0, end: 30 },
      filterIds: [],
      settings: {}
    };
  });

  const updateZoom = useCallback((zoom: { x: [number, number]; y: [number, number] }) => {
    setPlotState(prev => {
      const newState = { ...prev, zoom };
      saveUIElement(plotId, 'plot', newState);
      return newState;
    });
  }, [plotId, saveUIElement]);

  const updatePan = useCallback((pan: { x: number; y: number }) => {
    setPlotState(prev => {
      const newState = { ...prev, pan };
      saveUIElement(plotId, 'plot', newState);
      return newState;
    });
  }, [plotId, saveUIElement]);

  const updateTimeRange = useCallback((timeRange: { start: number; end: number }) => {
    setPlotState(prev => {
      const newState = { ...prev, timeRange };
      saveUIElement(plotId, 'plot', newState);
      return newState;
    });
  }, [plotId, saveUIElement]);

  const updateChannels = useCallback((channelIds: string[]) => {
    setPlotState(prev => {
      const newState = { ...prev, channelIds };
      saveUIElement(plotId, 'plot', newState);
      return newState;
    });
  }, [plotId, saveUIElement]);

  const updateFilters = useCallback((filterIds: string[]) => {
    setPlotState(prev => {
      const newState = { ...prev, filterIds };
      saveUIElement(plotId, 'plot', newState);
      return newState;
    });
  }, [plotId, saveUIElement]);

  const updateSettings = useCallback((settings: Record<string, any>) => {
    setPlotState(prev => {
      const newState = { ...prev, settings: { ...prev.settings, ...settings } };
      saveUIElement(plotId, 'plot', newState);
      return newState;
    });
  }, [plotId, saveUIElement]);

  return {
    plotState,
    updateZoom,
    updatePan,
    updateTimeRange,
    updateChannels,
    updateFilters,
    updateSettings
  };
}