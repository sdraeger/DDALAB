"use client";

import React, { useEffect, useRef, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectAllLoadedFiles, selectCurrentFilePath, removeFile, setCurrentFilePath, setFileData } from '@/store/slices/plotSlice';
import { apiService } from '@/lib/api';

interface LoadedFilesManagerProps {
  className?: string;
}

export function LoadedFilesManager({ className }: LoadedFilesManagerProps) {
  const dispatch = useAppDispatch();
  const loadedFiles = useAppSelector(selectAllLoadedFiles);
  const currentFilePath = useAppSelector(selectCurrentFilePath);
  const [isLoading, setIsLoading] = useState(false);
  const restoredRef = useRef(false);
  const lastPersistedStateRef = useRef<string>('');

  // Restore file state from persistence on mount
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const restoreFileState = async () => {
      setIsLoading(true);
      try {
        // Use a consistent key for file state persistence
        const storageKey = 'dda:loaded-files:v1';
        const response = await apiService.getWidgetData(storageKey);
        
        if (response.data?.data?.data) {
          const savedState = response.data.data.data;
          
          // Restore file paths to Redux store directly without events
          if (savedState.files && Array.isArray(savedState.files)) {
            for (const fileInfo of savedState.files) {
              if (fileInfo.filePath) {
                // Directly dispatch to Redux store instead of using events to avoid loops
                dispatch(setFileData({
                  filePath: fileInfo.filePath,
                  plotData: {
                    metadata: fileInfo.metadata || null,
                    edfData: null, // Will be loaded by widgets as needed
                    selectedChannels: fileInfo.selectedChannels || [],
                    ddaResults: null
                  }
                }));
              }
            }
          }
          
          // Restore current file selection
          if (savedState.currentFilePath) {
            dispatch(setCurrentFilePath(savedState.currentFilePath));
          }
        }
      } catch (err) {
        console.warn('Failed to restore file state:', err);
      } finally {
        setIsLoading(false);
      }
    };

    // Add a small delay to ensure Redux store is ready
    const timeoutId = setTimeout(restoreFileState, 100);
    return () => clearTimeout(timeoutId);
  }, [dispatch]);

  // Persist file state when it changes
  useEffect(() => {
    if (!restoredRef.current || isLoading) return;

    const currentStateKey = `${loadedFiles.length}-${currentFilePath || 'null'}`;
    
    // Only persist if state has actually changed
    if (currentStateKey === lastPersistedStateRef.current) {
      return;
    }

    const persistFileState = async () => {
      try {
        const storageKey = 'dda:loaded-files:v1';
        const fileState = {
          files: loadedFiles.map(filePath => ({
            filePath,
            // We could store more file info here if needed
            selectedChannels: [],
            metadata: null
          })),
          currentFilePath
        };

        await apiService.storeWidgetData({
          key: storageKey,
          data: fileState,
          widgetId: 'loaded-files-manager',
          metadata: { type: 'loaded-files', version: 'v1' }
        });
        
        lastPersistedStateRef.current = currentStateKey;
      } catch (err) {
        console.warn('Failed to persist file state:', err);
      }
    };

    // Only persist if there's actual data to save
    if (loadedFiles.length > 0 || currentFilePath !== null) {
      // Debounce saves
      const timeoutId = setTimeout(persistFileState, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [loadedFiles.length, currentFilePath, isLoading]);

  const handleRemoveFile = (filePath: string) => {
    dispatch(removeFile(filePath));
  };

  const getBasename = (path: string) => path.split('/').pop() || path;

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 text-muted-foreground ${className}`}>
        <FileText className="h-3 w-3" />
        <span className="text-xs">Loading files...</span>
      </div>
    );
  }

  if (loadedFiles.length === 0) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 text-muted-foreground ${className}`}>
        <FileText className="h-3 w-3" />
        <span className="text-xs">No files loaded</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-2 ${className}`}>
      <FileText className="h-3 w-3 text-muted-foreground" />
      <div className="flex items-center gap-1 text-xs">
        {loadedFiles.map((filePath, index) => (
          <div key={filePath} className="flex items-center gap-1">
            {index > 0 && <span className="text-muted-foreground">•</span>}
            <span className={`text-xs ${filePath === currentFilePath ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
              File {getBasename(filePath)} loaded
            </span>
            <button
              onClick={() => handleRemoveFile(filePath)}
              className="ml-1 p-0.5 hover:bg-accent rounded-sm text-muted-foreground hover:text-foreground"
              title={`Remove ${getBasename(filePath)}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}