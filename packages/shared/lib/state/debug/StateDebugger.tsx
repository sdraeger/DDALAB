"use client";

import React, { useState, useEffect } from 'react';
import { useStateStore } from '../react/StateContext';
import type { StateChangeEvent } from '../core/interfaces';

/**
 * Debug panel component for monitoring state changes
 */
export function StateDebugger({ 
  isOpen = false, 
  onToggle 
}: { 
  isOpen?: boolean; 
  onToggle?: (open: boolean) => void; 
}) {
  const store = useStateStore();
  const [debugInfo, setDebugInfo] = useState<any>({});
  const [slicesInfo, setSlicesInfo] = useState<any>({});
  const [recentEvents, setRecentEvents] = useState<StateChangeEvent[]>([]);
  const [selectedSlice, setSelectedSlice] = useState<string>('');

  // Update debug info periodically
  useEffect(() => {
    const updateDebugInfo = () => {
      setDebugInfo(store.getDebugInfo());
      setSlicesInfo(store.getSlicesMetadata());
    };

    updateDebugInfo();
    const interval = setInterval(updateDebugInfo, 1000);

    return () => clearInterval(interval);
  }, [store]);

  // Subscribe to state changes for event log
  useEffect(() => {
    const unsubscribe = store.onStateChange((event) => {
      setRecentEvents(prev => {
        const newEvents = [event, ...prev].slice(0, 100); // Keep last 100 events
        return newEvents;
      });
    });

    return unsubscribe;
  }, [store]);

  const exportState = () => {
    const state = store.exportState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ddalab-state-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importState = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const state = JSON.parse(text);
      await store.importState(state);
      alert('State imported successfully!');
    } catch (error) {
      alert(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const resetStore = async () => {
    if (confirm('Are you sure you want to reset all state? This cannot be undone.')) {
      await store.reset();
      setRecentEvents([]);
    }
  };

  if (!isOpen) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => onToggle?.(true)}
          className="bg-blue-600 text-white p-2 rounded-full shadow-lg hover:bg-blue-700 transition-colors"
          title="Open State Debugger"
        >
          🐛
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex">
      <div className="bg-white dark:bg-gray-900 w-2/3 h-full overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold">State Debugger</h2>
          <div className="flex gap-2">
            <button
              onClick={exportState}
              className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
            >
              Export
            </button>
            <label className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm cursor-pointer">
              Import
              <input
                type="file"
                accept=".json"
                onChange={importState}
                className="hidden"
              />
            </label>
            <button
              onClick={resetStore}
              className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
            >
              Reset All
            </button>
            <button
              onClick={() => onToggle?.(false)}
              className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-1/3 border-r dark:border-gray-700 overflow-y-auto">
            <div className="p-4">
              <h3 className="font-semibold mb-2">Store Info</h3>
              <div className="text-sm space-y-1 mb-4">
                <div>Slices: {debugInfo.slices?.length || 0}</div>
                <div>Events: {debugInfo.totalEvents || 0}</div>
                <div>Last Update: {debugInfo.lastUpdate ? new Date(debugInfo.lastUpdate).toLocaleTimeString() : 'Never'}</div>
                <div>Hydrated: {debugInfo.isHydrated ? '✅' : '❌'}</div>
              </div>

              <h3 className="font-semibold mb-2">Slices</h3>
              <div className="space-y-1">
                {Object.entries(slicesInfo).map(([key, info]: [string, any]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedSlice(selectedSlice === key ? '' : key)}
                    className={`w-full text-left p-2 rounded text-sm ${
                      selectedSlice === key 
                        ? 'bg-blue-100 dark:bg-blue-900' 
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <div className="font-medium">{key}</div>
                    <div className="text-xs text-gray-500">
                      {info?.listenerCount || 0} listeners
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1 overflow-y-auto">
            {selectedSlice ? (
              <div className="p-4">
                <h3 className="font-semibold mb-2">Slice: {selectedSlice}</h3>
                <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded mb-4">
                  <pre className="text-sm overflow-auto">
                    {JSON.stringify(slicesInfo[selectedSlice], null, 2)}
                  </pre>
                </div>
                
                <h4 className="font-semibold mb-2">Recent Events</h4>
                <div className="space-y-2">
                  {recentEvents
                    .filter(event => event.key === selectedSlice)
                    .slice(0, 20)
                    .map((event, index) => (
                      <div key={index} className="bg-gray-50 dark:bg-gray-800 p-2 rounded text-sm">
                        <div className="font-medium">{new Date(event.timestamp).toLocaleTimeString()}</div>
                        <div className="text-xs text-gray-600">
                          {JSON.stringify(event.oldValue)} → {JSON.stringify(event.newValue)}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <div className="p-4">
                <h3 className="font-semibold mb-2">Recent Events (All)</h3>
                <div className="space-y-2">
                  {recentEvents.slice(0, 50).map((event, index) => (
                    <div key={index} className="bg-gray-50 dark:bg-gray-800 p-2 rounded text-sm">
                      <div className="flex justify-between">
                        <span className="font-medium">{event.key}</span>
                        <span className="text-xs text-gray-500">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        {JSON.stringify(event.oldValue)} → {JSON.stringify(event.newValue)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Click outside to close */}
      <div 
        className="flex-1" 
        onClick={() => onToggle?.(false)}
      />
    </div>
  );
}

/**
 * Simple hook to toggle the debugger
 */
export function useStateDebugger() {
  const [isOpen, setIsOpen] = useState(false);

  return {
    isOpen,
    toggle: () => setIsOpen(!isOpen),
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    DebuggerComponent: () => (
      <StateDebugger 
        isOpen={isOpen} 
        onToggle={setIsOpen} 
      />
    )
  };
}