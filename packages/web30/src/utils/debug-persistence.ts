"use client";

import { statePersistenceService } from '@/services/StatePersistenceService';

// Debug utilities for persistence troubleshooting
export const debugPersistence = {
  // Log current session state
  logSessionState: () => {
    const session = statePersistenceService.getSessionState();
    console.group('🔧 Current Session State');
    console.log('Active Tab:', session.activeTab);
    console.log('Panel Sizes:', session.panelSizes);
    console.log('File Manager:', session.fileManager);
    console.log('UI Elements:', session.uiElements.length);
    console.log('Full Session:', session);
    console.groupEnd();
  },

  // Log localStorage contents
  logLocalStorage: () => {
    if (typeof window === 'undefined') return;
    
    console.group('💾 LocalStorage State');
    const keys = Object.keys(localStorage).filter(key => key.startsWith('web30-'));
    keys.forEach(key => {
      try {
        const value = JSON.parse(localStorage.getItem(key) || '{}');
        console.log(key, value);
      } catch (error) {
        console.log(key, localStorage.getItem(key));
      }
    });
    console.groupEnd();
  },

  // Clear all persistence data
  clearAll: () => {
    statePersistenceService.clearSession();
    console.log('🗑️ All persistence data cleared');
  },

  // Clear invalid file references
  clearInvalidFiles: () => {
    const session = statePersistenceService.getSessionState();
    if (session.fileManager.selectedFileId) {
      statePersistenceService.updateFileManagerState({
        selectedFileId: null,
        selectedChannelIds: [],
        hasEmptyChannelSelection: false
      });
      console.log('🗑️ Invalid file references cleared');
    } else {
      console.log('✅ No invalid file references found');
    }
  },

  // Test persistence save/restore
  testPersistence: () => {
    console.group('🧪 Testing Persistence');
    
    // Save test data
    statePersistenceService.saveSessionState({
      activeTab: 'test-tab',
      fileManager: {
        selectedFileId: 'test.edf',
        selectedChannelIds: ['CH1', 'CH2'],
        hasEmptyChannelSelection: false,
        activeFilters: [],
        timeWindow: { start: 10, end: 40 },
        expandedFolders: ['test-folder'],
        sortBy: 'name',
        sortOrder: 'asc'
      }
    });
    
    console.log('✅ Test data saved');
    
    // Retrieve test data
    const retrieved = statePersistenceService.getSessionState();
    console.log('📥 Retrieved data:', retrieved);
    
    // Verify
    const isValid = retrieved.activeTab === 'test-tab' && 
                   retrieved.fileManager.selectedFileId === 'test.edf';
    console.log(isValid ? '✅ Test passed' : '❌ Test failed');
    
    console.groupEnd();
    return isValid;
  }
};

// Add to window for easy access in browser console
if (typeof window !== 'undefined') {
  (window as any).debugPersistence = debugPersistence;
}