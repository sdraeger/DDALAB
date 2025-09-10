"use client";

import React from 'react';
import { useFileConfig } from '@/contexts/FileConfigContext';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';

interface FileConfigWidgetProps {
  widgetId?: string;
  isPopout?: boolean;
}

export function FileConfigWidget({ widgetId, isPopout }: FileConfigWidgetProps) {
  const { config, updateConfig, resetConfig } = useFileConfig();

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">File Configuration</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={resetConfig}
          className="gap-2"
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </Button>
      </div>

      {/* Data Processing Settings */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-muted-foreground">Data Processing</h4>
        
        <div className="space-y-2">
          <Label htmlFor="chunk-size">Chunk Size (seconds)</Label>
          <Input
            id="chunk-size"
            type="number"
            value={config.chunkSizeSeconds}
            onChange={(e) => updateConfig({ chunkSizeSeconds: parseFloat(e.target.value) || 10 })}
            min={1}
            max={300}
            step={0.5}
          />
          <p className="text-xs text-muted-foreground">Duration of each data chunk in seconds</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sampling-rate">Sampling Rate (Hz)</Label>
          <Input
            id="sampling-rate"
            type="number"
            value={config.samplingRate}
            onChange={(e) => updateConfig({ samplingRate: parseInt(e.target.value) || 1000 })}
            min={1}
            max={10000}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="window-size">Window Size (samples)</Label>
          <Input
            id="window-size"
            type="number"
            value={config.windowSize}
            onChange={(e) => updateConfig({ windowSize: parseInt(e.target.value) || 5000 })}
            min={100}
            max={100000}
            step={100}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="overlap">Overlap (samples)</Label>
          <Input
            id="overlap"
            type="number"
            value={config.overlap}
            onChange={(e) => updateConfig({ overlap: parseInt(e.target.value) || 500 })}
            min={0}
            max={config.windowSize - 1}
            step={50}
          />
        </div>
      </div>

      {/* Display Settings */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-muted-foreground">Display Settings</h4>
        
        <div className="space-y-2">
          <Label htmlFor="display-mode">Display Mode</Label>
          <Select value={config.displayMode} onValueChange={(value: 'continuous' | 'chunked') => updateConfig({ displayMode: value })}>
            <SelectTrigger id="display-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="continuous">Continuous</SelectItem>
              <SelectItem value="chunked">Chunked</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="auto-scale">Auto Scale</Label>
          <Switch
            id="auto-scale"
            checked={config.autoScale}
            onCheckedChange={(checked) => updateConfig({ autoScale: checked })}
          />
        </div>
      </div>

      {/* Filter Settings */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-muted-foreground">Filters</h4>
        
        <div className="space-y-2">
          <Label htmlFor="high-pass">High Pass Filter (Hz)</Label>
          <Input
            id="high-pass"
            type="number"
            value={config.filters.highPass || ''}
            placeholder="None"
            onChange={(e) => updateConfig({ 
              filters: { 
                ...config.filters, 
                highPass: e.target.value ? parseFloat(e.target.value) : null 
              }
            })}
            min={0}
            max={config.samplingRate / 2}
            step={0.1}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="low-pass">Low Pass Filter (Hz)</Label>
          <Input
            id="low-pass"
            type="number"
            value={config.filters.lowPass || ''}
            placeholder="None"
            onChange={(e) => updateConfig({ 
              filters: { 
                ...config.filters, 
                lowPass: e.target.value ? parseFloat(e.target.value) : null 
              }
            })}
            min={0}
            max={config.samplingRate / 2}
            step={0.1}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="notch">Notch Filter (Hz)</Label>
          <Input
            id="notch"
            type="number"
            value={config.filters.notch || ''}
            placeholder="None"
            onChange={(e) => updateConfig({ 
              filters: { 
                ...config.filters, 
                notch: e.target.value ? parseFloat(e.target.value) : null 
              }
            })}
            min={0}
            max={config.samplingRate / 2}
            step={0.1}
          />
        </div>
      </div>
    </div>
  );
}