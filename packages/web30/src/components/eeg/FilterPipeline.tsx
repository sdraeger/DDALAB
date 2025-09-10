"use client";

import React, { useState, useCallback, useMemo } from 'react';
import { Plus, Trash2, Eye, EyeOff, ArrowUp, ArrowDown, Settings, Sliders, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FilterConfig } from '@/types/eeg';
import { cn } from '@/lib/utils';

interface FilterPipelineProps {
  filters: FilterConfig[];
  onFiltersChange: (filters: FilterConfig[]) => void;
  previewEnabled?: boolean;
  onPreviewToggle?: () => void;
  sampleRate: number;
  className?: string;
}

const FILTER_TYPES = [
  { value: 'highpass', label: 'High Pass', description: 'Remove low frequencies' },
  { value: 'lowpass', label: 'Low Pass', description: 'Remove high frequencies' },
  { value: 'bandpass', label: 'Band Pass', description: 'Keep frequency range' },
  { value: 'notch', label: 'Notch', description: 'Remove specific frequency' },
  { value: 'custom', label: 'Custom', description: 'Custom filter' }
] as const;

const DEFAULT_FILTER_PARAMS: Record<FilterConfig['type'], Record<string, number>> = {
  highpass: { cutoff: 1.0, order: 4 },
  lowpass: { cutoff: 50.0, order: 4 },
  bandpass: { lowCutoff: 1.0, highCutoff: 50.0, order: 4 },
  notch: { frequency: 50.0, quality: 30 },
  custom: { param1: 0, param2: 0 }
};

const COMMON_PRESETS = [
  {
    name: 'EEG Standard',
    description: 'Standard EEG preprocessing',
    filters: [
      { type: 'highpass' as const, parameters: { cutoff: 0.5, order: 4 } },
      { type: 'lowpass' as const, parameters: { cutoff: 70, order: 4 } },
      { type: 'notch' as const, parameters: { frequency: 50, quality: 30 } }
    ]
  },
  {
    name: 'Alpha/Beta',
    description: 'Focus on alpha and beta bands',
    filters: [
      { type: 'bandpass' as const, parameters: { lowCutoff: 8, highCutoff: 30, order: 4 } }
    ]
  },
  {
    name: 'Artifact Removal',
    description: 'Remove common artifacts',
    filters: [
      { type: 'highpass' as const, parameters: { cutoff: 1.0, order: 6 } },
      { type: 'notch' as const, parameters: { frequency: 50, quality: 30 } },
      { type: 'notch' as const, parameters: { frequency: 100, quality: 30 } }
    ]
  }
];

interface FilterEditorProps {
  filter: FilterConfig;
  onUpdate: (filter: FilterConfig) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  sampleRate: number;
}

function FilterEditor({
  filter,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  sampleRate
}: FilterEditorProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleParameterChange = useCallback((key: string, value: number) => {
    onUpdate({
      ...filter,
      parameters: {
        ...filter.parameters,
        [key]: value
      }
    });
  }, [filter, onUpdate]);

  const renderParameterControls = () => {
    switch (filter.type) {
      case 'highpass':
      case 'lowpass':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Cutoff Frequency (Hz)</Label>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[filter.parameters.cutoff || 1]}
                  onValueChange={([value]) => handleParameterChange('cutoff', value)}
                  max={sampleRate / 2}
                  min={0.1}
                  step={0.1}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={filter.parameters.cutoff || 1}
                  onChange={(e) => handleParameterChange('cutoff', parseFloat(e.target.value) || 1)}
                  className="w-20 text-sm"
                  step="0.1"
                />
              </div>
            </div>
            <div>
              <Label className="text-sm">Filter Order</Label>
              <Select
                value={filter.parameters.order?.toString() || '4'}
                onValueChange={(value) => handleParameterChange('order', parseInt(value))}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2nd order</SelectItem>
                  <SelectItem value="4">4th order</SelectItem>
                  <SelectItem value="6">6th order</SelectItem>
                  <SelectItem value="8">8th order</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );

      case 'bandpass':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Low Cutoff (Hz)</Label>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[filter.parameters.lowCutoff || 1]}
                  onValueChange={([value]) => handleParameterChange('lowCutoff', value)}
                  max={(filter.parameters.highCutoff || 50) - 1}
                  min={0.1}
                  step={0.1}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={filter.parameters.lowCutoff || 1}
                  onChange={(e) => handleParameterChange('lowCutoff', parseFloat(e.target.value) || 1)}
                  className="w-20 text-sm"
                  step="0.1"
                />
              </div>
            </div>
            <div>
              <Label className="text-sm">High Cutoff (Hz)</Label>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[filter.parameters.highCutoff || 50]}
                  onValueChange={([value]) => handleParameterChange('highCutoff', value)}
                  max={sampleRate / 2}
                  min={(filter.parameters.lowCutoff || 1) + 1}
                  step={0.1}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={filter.parameters.highCutoff || 50}
                  onChange={(e) => handleParameterChange('highCutoff', parseFloat(e.target.value) || 50)}
                  className="w-20 text-sm"
                  step="0.1"
                />
              </div>
            </div>
            <div>
              <Label className="text-sm">Filter Order</Label>
              <Select
                value={filter.parameters.order?.toString() || '4'}
                onValueChange={(value) => handleParameterChange('order', parseInt(value))}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2nd order</SelectItem>
                  <SelectItem value="4">4th order</SelectItem>
                  <SelectItem value="6">6th order</SelectItem>
                  <SelectItem value="8">8th order</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );

      case 'notch':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Frequency (Hz)</Label>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[filter.parameters.frequency || 50]}
                  onValueChange={([value]) => handleParameterChange('frequency', value)}
                  max={sampleRate / 2}
                  min={1}
                  step={1}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={filter.parameters.frequency || 50}
                  onChange={(e) => handleParameterChange('frequency', parseFloat(e.target.value) || 50)}
                  className="w-20 text-sm"
                  step="1"
                />
              </div>
            </div>
            <div>
              <Label className="text-sm">Quality Factor</Label>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[filter.parameters.quality || 30]}
                  onValueChange={([value]) => handleParameterChange('quality', value)}
                  max={100}
                  min={1}
                  step={1}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={filter.parameters.quality || 30}
                  onChange={(e) => handleParameterChange('quality', parseFloat(e.target.value) || 30)}
                  className="w-20 text-sm"
                  step="1"
                />
              </div>
            </div>
          </div>
        );

      default:
        return (
          <div className="text-sm text-muted-foreground">
            Custom filter parameters can be configured here.
          </div>
        );
    }
  };

  const getFilterSummary = () => {
    switch (filter.type) {
      case 'highpass':
        return `>${filter.parameters.cutoff || 0}Hz`;
      case 'lowpass':
        return `<${filter.parameters.cutoff || 0}Hz`;
      case 'bandpass':
        return `${filter.parameters.lowCutoff || 0}-${filter.parameters.highCutoff || 0}Hz`;
      case 'notch':
        return `~${filter.parameters.frequency || 0}Hz`;
      default:
        return 'Custom';
    }
  };

  return (
    <Card className={cn("transition-all", !filter.enabled && "opacity-50")}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 p-0 h-auto">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {FILTER_TYPES.find(t => t.value === filter.type)?.label}
                  </Badge>
                  <span className="text-sm font-medium">{getFilterSummary()}</span>
                </div>
                <Settings className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-90")} />
              </Button>
            </CollapsibleTrigger>

            <div className="flex items-center gap-1">
              <Switch
                checked={filter.enabled}
                onCheckedChange={(enabled) => onUpdate({ ...filter, enabled })}
              />
              {onMoveUp && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onMoveUp}
                  disabled={!canMoveUp}
                >
                  <ArrowUp className="h-3 w-3" />
                </Button>
              )}
              {onMoveDown && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onMoveDown}
                  disabled={!canMoveDown}
                >
                  <ArrowDown className="h-3 w-3" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={onDelete}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0">
            {renderParameterControls()}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export function FilterPipeline({
  filters,
  onFiltersChange,
  previewEnabled = false,
  onPreviewToggle,
  sampleRate,
  className
}: FilterPipelineProps) {
  const [newFilterType, setNewFilterType] = useState<FilterConfig['type']>('highpass');

  const addFilter = useCallback((type: FilterConfig['type']) => {
    const newFilter: FilterConfig = {
      id: `filter-${Date.now()}`,
      type,
      enabled: true,
      parameters: { ...DEFAULT_FILTER_PARAMS[type] },
      order: filters.length
    };

    onFiltersChange([...filters, newFilter]);
  }, [filters, onFiltersChange]);

  const updateFilter = useCallback((filterId: string, updatedFilter: FilterConfig) => {
    onFiltersChange(filters.map(f => f.id === filterId ? updatedFilter : f));
  }, [filters, onFiltersChange]);

  const deleteFilter = useCallback((filterId: string) => {
    onFiltersChange(filters.filter(f => f.id !== filterId));
  }, [filters, onFiltersChange]);

  const moveFilter = useCallback((filterId: string, direction: 'up' | 'down') => {
    const index = filters.findIndex(f => f.id === filterId);
    if (index === -1) return;

    const newFilters = [...filters];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex >= 0 && targetIndex < filters.length) {
      [newFilters[index], newFilters[targetIndex]] = [newFilters[targetIndex], newFilters[index]];
      
      // Update order values
      newFilters.forEach((filter, i) => {
        filter.order = i;
      });

      onFiltersChange(newFilters);
    }
  }, [filters, onFiltersChange]);

  const applyPreset = useCallback((preset: typeof COMMON_PRESETS[0]) => {
    const presetFilters: FilterConfig[] = preset.filters.map((filterDef, index) => ({
      id: `preset-filter-${Date.now()}-${index}`,
      type: filterDef.type,
      enabled: true,
      parameters: filterDef.parameters as Record<string, number>,
      order: index
    }));

    onFiltersChange(presetFilters);
  }, [onFiltersChange]);

  const enabledFilters = useMemo(() => filters.filter(f => f.enabled), [filters]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders className="h-5 w-5" />
          <h3 className="text-lg font-semibold">Filter Pipeline</h3>
          {enabledFilters.length > 0 && (
            <Badge variant="outline">
              {enabledFilters.length} active
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onPreviewToggle && (
            <Button
              variant="outline"
              size="sm"
              onClick={onPreviewToggle}
              className={cn("gap-2", previewEnabled && "bg-primary text-primary-foreground")}
            >
              {previewEnabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              Preview
            </Button>
          )}
        </div>
      </div>

      {/* Quick Presets */}
      <div className="flex flex-wrap gap-2">
        {COMMON_PRESETS.map((preset) => (
          <Button
            key={preset.name}
            variant="outline"
            size="sm"
            onClick={() => applyPreset(preset)}
            className="text-xs"
          >
            <Zap className="h-3 w-3 mr-1" />
            {preset.name}
          </Button>
        ))}
      </div>

      {/* Add Filter */}
      <div className="flex items-center gap-2">
        <Select
          value={newFilterType}
          onValueChange={(value) => setNewFilterType(value as FilterConfig['type'])}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTER_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                <div>
                  <div className="font-medium">{type.label}</div>
                  <div className="text-xs text-muted-foreground">{type.description}</div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => addFilter(newFilterType)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Filter
        </Button>
      </div>

      {/* Filter List */}
      {filters.length > 0 ? (
        <ScrollArea className="max-h-96">
          <div className="space-y-2">
            {filters.map((filter, index) => (
              <FilterEditor
                key={filter.id}
                filter={filter}
                onUpdate={(updatedFilter) => updateFilter(filter.id, updatedFilter)}
                onDelete={() => deleteFilter(filter.id)}
                onMoveUp={index > 0 ? () => moveFilter(filter.id, 'up') : undefined}
                onMoveDown={index < filters.length - 1 ? () => moveFilter(filter.id, 'down') : undefined}
                canMoveUp={index > 0}
                canMoveDown={index < filters.length - 1}
                sampleRate={sampleRate}
              />
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <Sliders className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No filters configured</p>
          <p className="text-sm">Add a filter to start preprocessing your data</p>
        </div>
      )}

      {/* Pipeline Summary */}
      {enabledFilters.length > 0 && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="text-sm font-medium mb-1">Active Pipeline:</div>
          <div className="text-sm text-muted-foreground">
            {enabledFilters.map((filter, index) => (
              <span key={filter.id}>
                {FILTER_TYPES.find(t => t.value === filter.type)?.label}
                {index < enabledFilters.length - 1 && ' → '}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}