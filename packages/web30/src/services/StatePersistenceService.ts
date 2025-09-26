"use client";

import { apiService } from './apiService';

export interface UIElementReference {
  id: string;
  type: 'plot' | 'form' | 'panel' | 'widget';
  timestamp: number;
  lightweightState: Record<string, any>;
}

export interface FileManagerState {
  selectedFileId: string | null;
  selectedChannelIds: string[];
  hasEmptyChannelSelection?: boolean;
  activeFilters: string[];
  timeWindow: { start: number; end: number };
  expandedFolders: string[];
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export interface DashboardSession {
  activeTab: string;
  panelSizes: number[];
  uiElements: UIElementReference[];
  fileManager: FileManagerState;
  preferences: Record<string, any>;
  lastUpdated: number;
}

export class StatePersistenceService {
  private static instance: StatePersistenceService;
  private sessionKey = 'web30-session';
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private lastSavedState: string = '';
  private pendingUpdates: Partial<DashboardSession> = {};

  private constructor() {}

  static getInstance(): StatePersistenceService {
    if (!StatePersistenceService.instance) {
      StatePersistenceService.instance = new StatePersistenceService();
    }
    return StatePersistenceService.instance;
  }

  // Get current session state (lightweight local data only)
  getSessionState(): DashboardSession {
    if (typeof window === 'undefined') {
      return this.getDefaultSession();
    }

    try {
      const stored = localStorage.getItem(this.sessionKey);
      if (!stored) return this.getDefaultSession();

      const session = JSON.parse(stored);
      return {
        ...this.getDefaultSession(),
        ...session,
        lastUpdated: session.lastUpdated || Date.now()
      };
    } catch (error) {
      console.warn('Failed to load session state:', error);
      return this.getDefaultSession();
    }
  }

  // Save session state (lightweight data only)
  saveSessionState(session: Partial<DashboardSession>): void {
    if (typeof window === 'undefined') return;

    try {
      console.log('💾 saveSessionState called with:', session);
      const currentSession = this.getSessionState();
      const updatedSession = {
        ...currentSession,
        ...session,
        lastUpdated: Date.now()
      };
      console.log('💾 Updated session to save:', updatedSession);

      const sessionString = JSON.stringify(updatedSession);
      if (sessionString === this.lastSavedState) {
        console.log('⏭️ Skipping save - no changes detected');
        return;
      }

      localStorage.setItem(this.sessionKey, sessionString);
      this.lastSavedState = sessionString;
      console.log('✅ Session saved to localStorage');
    } catch (error) {
      console.warn('Failed to save session state:', error);
    }
  }

  // Schedule auto-save with debouncing
  scheduleAutoSave(session: Partial<DashboardSession>): void {
    // Accumulate updates - filter out undefined values
    const cleanSession = Object.fromEntries(
      Object.entries(session).filter(([_, value]) => value !== undefined)
    );
    
    console.log('🔄 cleanSession after filtering:', cleanSession);
    
    // Only merge fields that are actually provided
    this.pendingUpdates = {
      ...this.pendingUpdates,
      ...cleanSession
    };
    
    // Special handling for fileManager - only update if explicitly provided
    if (cleanSession.fileManager) {
      this.pendingUpdates.fileManager = {
        ...(this.pendingUpdates.fileManager || {}),
        ...cleanSession.fileManager
      };
    }
    
    console.log('🔄 Accumulated pending updates:', this.pendingUpdates);
    
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    this.autoSaveTimer = setTimeout(() => {
      console.log('💾 Auto-save triggered with pending updates:', this.pendingUpdates);
      this.saveSessionState(this.pendingUpdates);
      this.pendingUpdates = {}; // Clear pending updates after save
    }, 500); // 500ms debounce
  }

  // Clear all persisted state
  clearSession(): void {
    if (typeof window === 'undefined') return;

    try {
      localStorage.removeItem(this.sessionKey);
      this.lastSavedState = '';
    } catch (error) {
      console.warn('Failed to clear session:', error);
    }
  }

  // File Manager State Management
  updateFileManagerState(updates: Partial<FileManagerState>): void {
    const currentSession = this.getSessionState();
    this.scheduleAutoSave({
      fileManager: { ...currentSession.fileManager, ...updates }
    });
  }

  // UI Element Reference Management
  saveUIElementReference(
    elementId: string, 
    type: UIElementReference['type'], 
    lightweightState: Record<string, any>
  ): void {
    const currentSession = this.getSessionState();
    const updatedElements = currentSession.uiElements
      .filter(el => el.id !== elementId)
      .concat({
        id: elementId,
        type,
        lightweightState,
        timestamp: Date.now()
      });

    this.scheduleAutoSave({
      uiElements: updatedElements
    });
  }

  getUIElementReference(elementId: string): UIElementReference | null {
    const session = this.getSessionState();
    return session.uiElements.find(el => el.id === elementId) || null;
  }

  // Tab and Panel Management
  updateActiveTab(tab: string): void {
    this.scheduleAutoSave({ activeTab: tab });
  }

  updatePanelSizes(sizes: number[]): void {
    this.scheduleAutoSave({ panelSizes: sizes });
  }

  updatePreferences(preferences: Record<string, any>): void {
    const currentSession = this.getSessionState();
    this.scheduleAutoSave({
      preferences: { ...currentSession.preferences, ...preferences }
    });
  }

  // Heavy data management (fetch from API)
  async getFileData(fileId: string) {
    try {
      return await apiService.getFileInfo(fileId);
    } catch (error) {
      console.warn(`Failed to fetch file data for ${fileId}:`, error);
      return null;
    }
  }

  async getAnnotations(filePath: string) {
    try {
      return await apiService.getAnnotations(filePath);
    } catch (error) {
      console.warn(`Failed to fetch annotations for ${filePath}:`, error);
      return [];
    }
  }

  async getPlotData(plotId: string) {
    try {
      return await apiService.getPlotData(plotId);
    } catch (error) {
      console.warn(`Failed to fetch plot data for ${plotId}:`, error);
      return null;
    }
  }

  // Session restoration helper
  async restoreSession(): Promise<{
    session: DashboardSession;
    restoredData: {
      file?: any;
      annotations?: any[];
      plots?: Record<string, any>;
    }
  }> {
    const session = this.getSessionState();
    const restoredData: any = {};

    // Restore file data if we have a selected file
    if (session.fileManager.selectedFileId) {
      restoredData.file = await this.getFileData(session.fileManager.selectedFileId);
      
      if (restoredData.file) {
        restoredData.annotations = await this.getAnnotations(restoredData.file.file_path);
      }
    }

    // Restore plot data for UI elements
    const plotElements = session.uiElements.filter(el => el.type === 'plot');
    if (plotElements.length > 0) {
      restoredData.plots = {};
      await Promise.all(
        plotElements.map(async (element) => {
          const plotData = await this.getPlotData(element.id);
          if (plotData) {
            restoredData.plots[element.id] = plotData;
          }
        })
      );
    }

    return { session, restoredData };
  }

  // Export/Import for debugging
  exportSession(): Record<string, any> {
    return {
      [this.sessionKey]: this.getSessionState()
    };
  }

  importSession(data: Record<string, any>): void {
    if (data[this.sessionKey]) {
      this.saveSessionState(data[this.sessionKey]);
    }
  }

  private getDefaultSession(): DashboardSession {
    return {
      activeTab: 'eeg',
      panelSizes: [25, 50, 25],
      uiElements: [],
      fileManager: {
        selectedFileId: null,
        selectedChannelIds: [],
        hasEmptyChannelSelection: false,
        activeFilters: [],
        timeWindow: { start: 0, end: 30 },
        expandedFolders: [],
        sortBy: 'name',
        sortOrder: 'asc'
      },
      preferences: {},
      lastUpdated: Date.now()
    };
  }

  // Cleanup old UI element references (keep only last 50)
  cleanupOldReferences(): void {
    const session = this.getSessionState();
    if (session.uiElements.length > 50) {
      const sortedElements = session.uiElements
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 50);
      
      this.saveSessionState({
        uiElements: sortedElements
      });
    }
  }
}

export const statePersistenceService = StatePersistenceService.getInstance();