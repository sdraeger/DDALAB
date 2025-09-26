'use client'

import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function PersistenceDebugger() {
  const [testState, setTestState] = useState({
    counter: 0,
    lastUpdated: new Date().toISOString(),
    testData: 'Hello World'
  });
  const [savedState, setSavedState] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    console.log('DEBUG:', message);
    setLogs(prev => [...prev.slice(-20), `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  // Test basic Tauri invoke
  const testBasicInvoke = async () => {
    try {
      addLog('Testing basic invoke...');
      const result = await invoke('get_app_state');
      addLog(`Basic invoke success: ${JSON.stringify(result).slice(0, 100)}...`);
      setSavedState(result);
    } catch (error) {
      addLog(`Basic invoke failed: ${error}`);
    }
  };

  // Test save operation
  const testSave = async () => {
    try {
      addLog('Testing save operation...');
      const stateToSave = {
        ...testState,
        counter: testState.counter + 1,
        lastUpdated: new Date().toISOString()
      };
      
      await invoke('save_complete_state', { completeState: stateToSave });
      setTestState(stateToSave);
      addLog('Save operation completed');
    } catch (error) {
      addLog(`Save operation failed: ${error}`);
    }
  };

  // Test load operation
  const testLoad = async () => {
    try {
      addLog('Testing load operation...');
      const result = await invoke('get_saved_state');
      addLog(`Load operation success: ${JSON.stringify(result).slice(0, 100)}...`);
      setSavedState(result);
    } catch (error) {
      addLog(`Load operation failed: ${error}`);
    }
  };

  // Test force save
  const testForceSave = async () => {
    try {
      addLog('Testing force save...');
      await invoke('force_save_state');
      addLog('Force save completed');
    } catch (error) {
      addLog(`Force save failed: ${error}`);
    }
  };

  // Auto test on mount
  useEffect(() => {
    addLog('PersistenceDebugger mounted');
    addLog(`window.__TAURI__ exists: ${typeof window !== 'undefined' && '__TAURI__' in window}`);
    testBasicInvoke();
  }, []);

  return (
    <div className="p-4 border border-gray-300 rounded-lg bg-gray-50 max-w-2xl">
      <h2 className="text-lg font-bold mb-4">Persistence Debugger</h2>
      
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <h3 className="font-semibold mb-2">Test State</h3>
          <div className="text-sm bg-white p-2 rounded border">
            <div>Counter: {testState.counter}</div>
            <div>Last Updated: {testState.lastUpdated}</div>
            <div>Data: {testState.testData}</div>
          </div>
        </div>
        
        <div>
          <h3 className="font-semibold mb-2">Saved State Preview</h3>
          <div className="text-sm bg-white p-2 rounded border h-20 overflow-auto">
            {savedState ? (
              <pre>{JSON.stringify(savedState, null, 2)}</pre>
            ) : (
              'No saved state loaded'
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button 
          onClick={testBasicInvoke}
          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Test Basic Invoke
        </button>
        <button 
          onClick={testSave}
          className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
        >
          Test Save
        </button>
        <button 
          onClick={testLoad}
          className="px-3 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600"
        >
          Test Load
        </button>
        <button 
          onClick={testForceSave}
          className="px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600"
        >
          Force Save
        </button>
      </div>

      <div>
        <h3 className="font-semibold mb-2">Debug Logs</h3>
        <div className="text-xs bg-black text-green-400 p-2 rounded h-40 overflow-auto font-mono">
          {logs.map((log, index) => (
            <div key={index}>{log}</div>
          ))}
        </div>
      </div>
    </div>
  );
}