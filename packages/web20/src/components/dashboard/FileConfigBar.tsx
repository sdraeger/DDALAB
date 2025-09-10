"use client";

import React from 'react';
import { useFileConfig } from '@/contexts/FileConfigContext';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Sliders, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

export function FileConfigBar() {
  const { config, updateConfig, resetConfig } = useFileConfig();
  const [isExpanded, setIsExpanded] = React.useState(false);
  
  console.log('[FileConfigBar] Rendering with config:', config);
  
  // Local state for input values
  const [chunkSizeInput, setChunkSizeInput] = React.useState<string>('');
  const [samplingRateInput, setSamplingRateInput] = React.useState<string>('');
  
  // Initialize input values from config
  React.useEffect(() => {
    setChunkSizeInput(config.chunkSizeSeconds.toString());
    setSamplingRateInput(config.samplingRate.toString());
  }, [config.chunkSizeSeconds, config.samplingRate]);

  const handleChunkSizeChange = (value: string) => {
    console.log('[FileConfigBar] Chunk size input value:', value);
    setChunkSizeInput(value);
    
    const seconds = parseFloat(value);
    console.log('[FileConfigBar] Parsed seconds:', seconds);
    if (!isNaN(seconds) && seconds > 0) {
      console.log('[FileConfigBar] Updating chunk size to:', seconds, 'seconds');
      console.log('[FileConfigBar] Current config before update:', config);
      updateConfig({ chunkSizeSeconds: seconds });
    } else {
      console.log('[FileConfigBar] Invalid input, not updating');
    }
  };
  
  const handleSamplingRateChange = (value: string) => {
    setSamplingRateInput(value);
    const rate = parseInt(value);
    if (!isNaN(rate) && rate > 0) {
      updateConfig({ samplingRate: rate });
    }
  };
  
  // Local state for expanded inputs
  const [windowSizeInput, setWindowSizeInput] = React.useState<string>('');
  const [overlapInput, setOverlapInput] = React.useState<string>('');
  
  React.useEffect(() => {
    setWindowSizeInput((config.windowSize / config.samplingRate).toFixed(1));
    setOverlapInput((config.overlap / config.samplingRate).toFixed(2));
  }, [config.windowSize, config.overlap, config.samplingRate]);

  return (
    <div className="border-b bg-muted/50 transition-all duration-200">
      <div className="px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">File Configuration</span>
            </div>

            {/* Primary controls always visible */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="chunk-size" className="text-xs whitespace-nowrap">
                  Chunk Size:
                </Label>
                <Input
                  id="chunk-size"
                  type="number"
                  value={chunkSizeInput}
                  onChange={(e) => handleChunkSizeChange(e.target.value)}
                  onFocus={() => console.log('[FileConfigBar] Chunk size input focused')}
                  onClick={() => console.log('[FileConfigBar] Chunk size input clicked')}
                  className="h-7 w-20 text-xs"
                  min={0.1}
                  max={100}
                  step={0.1}
                />
                <span className="text-xs text-muted-foreground">sec</span>
              </div>

              <div className="flex items-center gap-2">
                <Label htmlFor="sampling-rate" className="text-xs whitespace-nowrap">
                  Sampling Rate:
                </Label>
                <Input
                  id="sampling-rate"
                  type="number"
                  value={samplingRateInput}
                  onChange={(e) => handleSamplingRateChange(e.target.value)}
                  className="h-7 w-20 text-xs"
                  min={1}
                  max={10000}
                />
                <span className="text-xs text-muted-foreground">Hz</span>
              </div>

              <div className="flex items-center gap-2">
                <Label htmlFor="display-mode" className="text-xs">
                  Display:
                </Label>
                <Select 
                  value={config.displayMode} 
                  onValueChange={(value: 'continuous' | 'chunked') => updateConfig({ displayMode: value })}
                >
                  <SelectTrigger id="display-mode" className="h-7 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="continuous" className="text-xs">Continuous</SelectItem>
                    <SelectItem value="chunked" className="text-xs">Chunked</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Label htmlFor="auto-scale" className="text-xs">
                  Auto Scale:
                </Label>
                <Switch
                  id="auto-scale"
                  checked={config.autoScale}
                  onCheckedChange={(checked) => updateConfig({ autoScale: checked })}
                  className="scale-75"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-7 px-2"
            >
              {isExpanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetConfig}
              className="h-7 px-2 gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              <span className="text-xs">Reset</span>
            </Button>
          </div>
        </div>

        {/* Expanded section with advanced options */}
        {isExpanded && (
          <div className="mt-3 pt-3 border-t grid grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="window-size" className="text-xs whitespace-nowrap">
                Window Size:
              </Label>
              <Input
                id="window-size"
                type="number"
                value={windowSizeInput}
                onChange={(e) => {
                  const value = e.target.value;
                  setWindowSizeInput(value);
                  const seconds = parseFloat(value);
                  if (!isNaN(seconds) && seconds > 0) {
                    updateConfig({ windowSize: Math.round(seconds * config.samplingRate) });
                  }
                }}
                className="h-7 w-16 text-xs"
                min={0.1}
                max={100}
                step={0.1}
              />
              <span className="text-xs text-muted-foreground">sec</span>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="overlap" className="text-xs whitespace-nowrap">
                Overlap:
              </Label>
              <Input
                id="overlap"
                type="number"
                value={overlapInput}
                onChange={(e) => {
                  const value = e.target.value;
                  setOverlapInput(value);
                  const seconds = parseFloat(value);
                  if (!isNaN(seconds) && seconds >= 0) {
                    updateConfig({ overlap: Math.round(seconds * config.samplingRate) });
                  }
                }}
                className="h-7 w-16 text-xs"
                min={0}
                max={config.windowSize / config.samplingRate - 0.1}
                step={0.05}
              />
              <span className="text-xs text-muted-foreground">sec</span>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="high-pass" className="text-xs whitespace-nowrap">
                High Pass:
              </Label>
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
                className="h-7 w-16 text-xs"
                min={0}
                max={config.samplingRate / 2}
                step={0.1}
              />
              <span className="text-xs text-muted-foreground">Hz</span>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="low-pass" className="text-xs whitespace-nowrap">
                Low Pass:
              </Label>
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
                className="h-7 w-16 text-xs"
                min={0}
                max={config.samplingRate / 2}
                step={0.1}
              />
              <span className="text-xs text-muted-foreground">Hz</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}