"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { debugPersistence } from '@/utils/debug-persistence';
import { useSessionPersistence, useFileManagerPersistence } from '@/hooks/useSessionPersistence';

export default function DebugPersistencePage() {
  const { session, isLoaded, updateActiveTab, clearSession, updateFileManagerState, saveUIElement, getUIElement } = useSessionPersistence();
  const { fileManager, selectFile, selectChannels } = useFileManagerPersistence(session, updateFileManagerState);
  const [testResults, setTestResults] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('debug-test-results');
        return saved ? JSON.parse(saved) : [];
      } catch {
        return [];
      }
    }
    return [];
  });
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch by only rendering after client mount
  useEffect(() => {
    setMounted(true);
  }, []);

  const addResult = (message: string) => {
    const newResults = [message, ...testResults.slice(0, 9)]; // Keep last 10 results
    setTestResults(newResults);
    if (typeof window !== 'undefined') {
      localStorage.setItem('debug-test-results', JSON.stringify(newResults));
    }
  };

  const runTest = (testName: string, testFn: () => any) => {
    try {
      const result = testFn();
      addResult(`✅ ${testName}: ${JSON.stringify(result)}`);
    } catch (error) {
      addResult(`❌ ${testName}: ${error}`);
    }
  };

  // Show loading state until mounted and session loaded
  if (!mounted || !isLoaded) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-3xl font-bold">Persistence Debug Page</h1>
        <p className="mt-4">Loading session state...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Persistence Debug Page</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Current State</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <strong>Active Tab:</strong> {session.activeTab}
            </div>
            <div>
              <strong>Selected File:</strong> {fileManager.selectedFileId || 'None'}
            </div>
            <div>
              <strong>Selected Channels:</strong> {fileManager.selectedChannelIds.join(', ') || 'None'}
            </div>
            <div>
              <strong>Empty Selection Flag:</strong> {fileManager.hasEmptyChannelSelection ? 'Yes' : 'No'}
            </div>
            <div>
              <strong>Panel Sizes:</strong> {session.panelSizes.join(', ')}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Test Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button onClick={() => runTest('Change Tab', () => updateActiveTab('dda'))} className="w-full">
              Change Tab to DDA
            </Button>
            
            <Button onClick={() => runTest('Select File', () => selectFile('copy.edf'))} className="w-full">
              Select Test File (copy.edf)
            </Button>
            
            <Button onClick={() => runTest('Select Channels', () => selectChannels(['C3', 'C4', 'F3', 'F4']))} className="w-full">
              Select Test Channels
            </Button>
            
            <Button onClick={() => runTest('Clear Channels', () => selectChannels([]))} className="w-full">
              Clear All Channels
            </Button>
            
            <Button onClick={() => runTest('Run Persistence Test', () => debugPersistence.testPersistence())} className="w-full">
              Run Persistence Test
            </Button>
            
            <Button onClick={() => runTest('Log Session', () => debugPersistence.logSessionState())} className="w-full">
              Log Session State
            </Button>
            
            <Button onClick={() => runTest('Log LocalStorage', () => debugPersistence.logLocalStorage())} className="w-full">
              Log LocalStorage
            </Button>
            
            <Button onClick={() => runTest('Clear Invalid Files', () => debugPersistence.clearInvalidFiles())} className="w-full">
              Clear Invalid File References
            </Button>
            
            <Button 
              onClick={() => {
                clearSession();
                addResult('🗑️ Session cleared');
                window.location.reload();
              }} 
              variant="destructive" 
              className="w-full"
            >
              Clear Session & Reload
            </Button>
            
            <Button 
              onClick={() => {
                setTestResults([]);
                localStorage.removeItem('debug-test-results');
              }} 
              variant="outline" 
              className="w-full"
            >
              Clear Test Results
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Test Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 font-mono text-sm max-h-64 overflow-y-auto">
            {testResults.length === 0 ? (
              <p className="text-muted-foreground">No test results yet</p>
            ) : (
              testResults.map((result, index) => (
                <div key={index} className="p-2 bg-muted rounded">
                  {result}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li>Use the test actions above to change the application state</li>
            <li>Open browser DevTools console to see detailed debug logs</li>
            <li>Reload the page to test persistence</li>
            <li>Check that your state is restored correctly</li>
            <li>Use the debug functions in the console: <code>debugPersistence.logSessionState()</code></li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}