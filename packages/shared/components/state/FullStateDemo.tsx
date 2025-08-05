"use client";

import React from 'react';
import { useDashboardStateBridge } from './DashboardStateIntegration';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';

/**
 * Comprehensive demo showing the full centralized state management system in action
 */
export function FullStateDemo() {
  const dashboardState = useDashboardStateBridge();

  const addSampleWidgets = async () => {
    const widgets = [
      {
        type: 'file-browser',
        config: {
          title: 'File Browser',
          position: { x: 50, y: 50 },
          size: { width: 400, height: 300 }
        }
      },
      {
        type: 'chart',
        config: {
          title: 'EEG Chart',
          position: { x: 500, y: 50 },
          size: { width: 500, height: 350 }
        }
      },
      {
        type: 'test-widget',
        config: {
          title: 'Test Widget',
          position: { x: 100, y: 400 },
          size: { width: 300, height: 200 }
        }
      }
    ];

    for (const widget of widgets) {
      await dashboardState.addWidget(widget.type, widget.config);
    }
  };

  const demonstrateStateFeatures = async () => {
    // Demo 1: File and channel management
    await dashboardState.setCurrentFile('/demo/sample_eeg.edf');
    await dashboardState.setSelectedChannels(['C3', 'C4', 'O1', 'O2']);
    
    // Demo 2: Time window and zoom
    await dashboardState.setTimeWindow([0, 30]);
    await dashboardState.setZoomLevel(2.5);
    
    // Demo 3: Theme switching
    const newTheme = dashboardState.theme === 'dark' ? 'light' : 'dark';
    await dashboardState.setTheme(newTheme);
    
    // Demo 4: Grid settings
    await dashboardState.updateWidget(
      dashboardState.widgets[0]?.id || 'none',
      { position: { x: 200, y: 200 } }
    );
  };

  const clearAllState = async () => {
    await dashboardState.resetLayout();
    await dashboardState.resetPlot();
    await dashboardState.setCurrentFile(null);
    await dashboardState.setSelectedChannels([]);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          🎯 Centralized State Management Demo
          <Badge variant="secondary">
            {dashboardState.debugMode ? 'Debug ON' : 'Debug OFF'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* State Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="bg-muted p-3 rounded-lg">
            <div className="font-semibold">Widgets</div>
            <div className="text-2xl font-bold text-primary">
              {dashboardState.widgets.length}
            </div>
          </div>
          <div className="bg-muted p-3 rounded-lg">
            <div className="font-semibold">Current File</div>
            <div className="text-xs text-muted-foreground truncate">
              {dashboardState.currentFilePath || 'None'}
            </div>
          </div>
          <div className="bg-muted p-3 rounded-lg">
            <div className="font-semibold">Channels</div>
            <div className="text-2xl font-bold text-primary">
              {dashboardState.selectedChannels.length}
            </div>
          </div>
          <div className="bg-muted p-3 rounded-lg">
            <div className="font-semibold">Theme</div>
            <div className="font-mono text-sm">
              {dashboardState.theme}
            </div>
          </div>
        </div>

        <Separator />

        {/* Plot State Details */}
        <div className="space-y-2">
          <h4 className="font-semibold">Plot State</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-medium">Time Window:</span> 
              {dashboardState.timeWindow ? 
                ` [${dashboardState.timeWindow[0]}, ${dashboardState.timeWindow[1]}]s` : 
                ' Default'
              }
            </div>
            <div>
              <span className="font-medium">Zoom Level:</span> {dashboardState.zoomLevel}x
            </div>
          </div>
          <div>
            <span className="font-medium">Selected Channels:</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {dashboardState.selectedChannels.length > 0 ? (
                dashboardState.selectedChannels.map(channel => (
                  <Badge key={channel} variant="outline" className="text-xs">
                    {channel}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground text-sm">None selected</span>
              )}
            </div>
          </div>
        </div>

        <Separator />

        {/* Layout State Details */}
        <div className="space-y-2">
          <h4 className="font-semibold">Layout State</h4>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="font-medium">Grid Size:</span> {dashboardState.gridSize}px
            </div>
            <div>
              <span className="font-medium">Snapping:</span> {dashboardState.enableSnapping ? 'ON' : 'OFF'}
            </div>
            <div>
              <span className="font-medium">Selected:</span> {dashboardState.selectedWidget || 'None'}
            </div>
          </div>
          <div>
            <span className="font-medium">Widgets:</span>
            <div className="space-y-1 mt-1">
              {dashboardState.widgets.length > 0 ? (
                dashboardState.widgets.map(widget => (
                  <div key={widget.id} className="flex items-center justify-between bg-muted/50 p-2 rounded text-xs">
                    <span className="font-mono">{widget.id}</span>
                    <Badge variant="outline">{widget.type}</Badge>
                    <span className="text-muted-foreground">
                      {widget.position.x}, {widget.position.y}
                    </span>
                  </div>
                ))
              ) : (
                <span className="text-muted-foreground text-sm">No widgets</span>
              )}
            </div>
          </div>
        </div>

        <Separator />

        {/* Demo Actions */}
        <div className="space-y-3">
          <h4 className="font-semibold">Demo Actions</h4>
          <div className="flex flex-wrap gap-2">
            <Button onClick={addSampleWidgets} size="sm">
              Add Sample Widgets
            </Button>
            <Button onClick={demonstrateStateFeatures} size="sm" variant="secondary">
              Demo State Features
            </Button>
            <Button onClick={() => void dashboardState.toggleDebugMode()} size="sm" variant="outline">
              Toggle Debug Mode
            </Button>
            <Button onClick={() => void dashboardState.toggleSidebar()} size="sm" variant="outline">
              Toggle Sidebar
            </Button>
            <Button onClick={clearAllState} size="sm" variant="destructive">
              Clear All State
            </Button>
          </div>
        </div>

        {/* Loading States */}
        {(dashboardState.isLayoutLoading || dashboardState.isPlotLoading || dashboardState.isSettingsLoading) && (
          <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg">
            <div className="font-semibold text-yellow-800">Loading States Active</div>
            <div className="text-sm text-yellow-700 space-y-1">
              {dashboardState.isLayoutLoading && <div>• Layout loading...</div>}
              {dashboardState.isPlotLoading && <div>• Plot loading...</div>}
              {dashboardState.isSettingsLoading && <div>• Settings loading...</div>}
            </div>
          </div>
        )}

        {/* Error States */}
        {(dashboardState.layoutError || dashboardState.plotError || dashboardState.settingsError) && (
          <div className="bg-red-50 border border-red-200 p-3 rounded-lg">
            <div className="font-semibold text-red-800">Errors Detected</div>
            <div className="text-sm text-red-700 space-y-1">
              {dashboardState.layoutError && <div>• Layout: {dashboardState.layoutError.message}</div>}
              {dashboardState.plotError && <div>• Plot: {dashboardState.plotError.message}</div>}
              {dashboardState.settingsError && <div>• Settings: {dashboardState.settingsError.message}</div>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}