"use client";

import React, { useEffect, useState } from 'react';
import { useDashboardStateBridge } from './DashboardStateIntegration';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

/**
 * Test component to validate the state management system integration
 */
export function StateTestComponent() {
  const dashboardState = useDashboardStateBridge();
  const [testResults, setTestResults] = useState<string[]>([]);

  const addTestResult = (result: string) => {
    setTestResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ${result}`]);
  };

  const runTests = async () => {
    setTestResults([]);
    addTestResult('Starting state management tests...');

    try {
      // Test 1: Add a widget
      addTestResult('Test 1: Adding widget...');
      const widget = await dashboardState.addWidget('test-widget', {
        title: 'Test Widget',
        position: { x: 50, y: 50 },
        size: { width: 300, height: 200 }
      });
      addTestResult(`✓ Widget added successfully: ${widget.id}`);

      // Test 2: Update widget
      addTestResult('Test 2: Updating widget...');
      await dashboardState.updateWidget(widget.id, { title: 'Updated Test Widget' });
      addTestResult('✓ Widget updated successfully');

      // Test 3: Set plot file
      addTestResult('Test 3: Setting plot file...');
      await dashboardState.setCurrentFile('/test/file/path.edf');
      addTestResult(`✓ Plot file set: ${dashboardState.currentFilePath}`);

      // Test 4: Set selected channels
      addTestResult('Test 4: Setting selected channels...');
      await dashboardState.setSelectedChannels(['channel1', 'channel2', 'channel3']);
      addTestResult(`✓ Channels set: ${dashboardState.selectedChannels.join(', ')}`);

      // Test 5: Toggle theme
      addTestResult('Test 5: Toggling theme...');
      const originalTheme = dashboardState.theme;
      await dashboardState.setTheme(originalTheme === 'dark' ? 'light' : 'dark');
      addTestResult(`✓ Theme changed from ${originalTheme} to ${dashboardState.theme}`);

      // Test 6: Toggle sidebar
      addTestResult('Test 6: Toggling sidebar...');
      const originalSidebarState = dashboardState.sidebarCollapsed;
      await dashboardState.toggleSidebar();
      addTestResult(`✓ Sidebar toggled from ${originalSidebarState} to ${dashboardState.sidebarCollapsed}`);

      // Test 7: Remove widget
      addTestResult('Test 7: Removing widget...');
      await dashboardState.removeWidget(widget.id);
      addTestResult('✓ Widget removed successfully');

      addTestResult('🎉 All tests passed!');

    } catch (error) {
      addTestResult(`❌ Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const clearTests = () => {
    setTestResults([]);
  };

  useEffect(() => {
    addTestResult('State management system initialized');
    addTestResult(`Current widgets: ${dashboardState.widgets.length}`);
    addTestResult(`Current file: ${dashboardState.currentFilePath || 'None'}`);
    addTestResult(`Theme: ${dashboardState.theme}`);
    addTestResult(`Sidebar collapsed: ${dashboardState.sidebarCollapsed}`);
  }, []);

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>State Management System Test</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={runTests}>Run Tests</Button>
            <Button variant="outline" onClick={clearTests}>Clear Results</Button>
            <Button 
              variant="outline" 
              onClick={() => dashboardState.toggleDebugMode()}
            >
              {dashboardState.debugMode ? 'Disable' : 'Enable'} Debug Mode
            </Button>
          </div>

          <div className="bg-muted p-4 rounded-lg max-h-96 overflow-y-auto">
            <h4 className="font-medium mb-2">Current State:</h4>
            <div className="text-sm space-y-1">
              <div>Widgets: {dashboardState.widgets.length}</div>
              <div>Current File: {dashboardState.currentFilePath || 'None'}</div>
              <div>Selected Channels: {dashboardState.selectedChannels.length}</div>
              <div>Theme: {dashboardState.theme}</div>
              <div>Sidebar Collapsed: {dashboardState.sidebarCollapsed.toString()}</div>
              <div>Debug Mode: {dashboardState.debugMode.toString()}</div>
              <div>Loading States: Layout={dashboardState.isLayoutLoading.toString()}, Plot={dashboardState.isPlotLoading.toString()}</div>
            </div>
          </div>

          {testResults.length > 0 && (
            <div className="bg-muted p-4 rounded-lg max-h-96 overflow-y-auto">
              <h4 className="font-medium mb-2">Test Results:</h4>
              <div className="text-sm space-y-1">
                {testResults.map((result, index) => (
                  <div key={index} className="font-mono">
                    {result}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}