"use client";

import React, { useState, useMemo } from 'react';
import { Search, Filter, Grid, List, Eye, EyeOff, Bookmark, Settings } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { ChannelTopologyMap } from './ChannelTopologyMap';
import { EEGChannel, ChannelPreset, ChannelGroup } from '@/types/eeg';
import { cn } from '@/lib/utils';

interface ChannelSelectorProps {
  channels: EEGChannel[];
  selectedChannels: string[];
  onSelectionChange: (channelIds: string[]) => void;
  presets: ChannelPreset[];
  onPresetSave: (preset: Omit<ChannelPreset, 'id'>) => void;
  className?: string;
}

const DEFAULT_PRESETS: ChannelPreset[] = [
  {
    id: 'all',
    name: 'All Channels',
    description: 'Select all available channels',
    channels: [],
    group: 'other'
  },
  {
    id: 'frontal',
    name: 'Frontal',
    description: 'Frontal cortex channels',
    channels: ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8'],
    group: 'frontal'
  },
  {
    id: 'central',
    name: 'Central',
    description: 'Central cortex channels',
    channels: ['T7', 'C3', 'Cz', 'C4', 'T8'],
    group: 'central'
  },
  {
    id: 'parietal',
    name: 'Parietal',
    description: 'Parietal cortex channels',
    channels: ['P7', 'P3', 'Pz', 'P4', 'P8'],
    group: 'parietal'
  },
  {
    id: 'occipital',
    name: 'Occipital',
    description: 'Occipital cortex channels',
    channels: ['O1', 'Oz', 'O2'],
    group: 'occipital'
  }
];

const CHANNEL_GROUP_COLORS: Record<ChannelGroup, string> = {
  frontal: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  central: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  parietal: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  occipital: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  temporal: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300',
  other: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300'
};

export function ChannelSelector({
  channels,
  selectedChannels,
  onSelectionChange,
  presets,
  onPresetSave,
  className
}: ChannelSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeView, setActiveView] = useState<'topology' | 'list' | 'grid'>('topology');
  const [filterGroup, setFilterGroup] = useState<ChannelGroup | 'all'>('all');

  const allPresets = useMemo(() => [...DEFAULT_PRESETS, ...presets], [presets]);

  const filteredChannels = useMemo(() => {
    return channels.filter(channel => {
      const matchesSearch = channel.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          channel.id.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesGroup = filterGroup === 'all' || channel.group === filterGroup;
      
      return matchesSearch && matchesGroup;
    });
  }, [channels, searchTerm, filterGroup]);

  const channelGroups = useMemo(() => {
    const groups: Record<ChannelGroup, EEGChannel[]> = {
      frontal: [],
      central: [],
      parietal: [],
      occipital: [],
      temporal: [],
      other: []
    };
    
    filteredChannels.forEach(channel => {
      const group = channel.group || 'other';
      groups[group].push(channel);
    });
    
    return groups;
  }, [filteredChannels]);

  const handleChannelToggle = (channelId: string) => {
    const newSelection = selectedChannels.includes(channelId)
      ? selectedChannels.filter(id => id !== channelId)
      : [...selectedChannels, channelId];
    
    onSelectionChange(newSelection);
  };

  const handlePresetSelect = (preset: ChannelPreset) => {
    if (preset.id === 'all') {
      onSelectionChange(channels.map(c => c.id));
    } else {
      const presetChannelIds = channels
        .filter(c => preset.channels.includes(c.label))
        .map(c => c.id);
      onSelectionChange(presetChannelIds);
    }
  };

  const handleGroupToggle = (group: ChannelGroup) => {
    const groupChannelIds = channelGroups[group].map(c => c.id);
    const allSelected = groupChannelIds.every(id => selectedChannels.includes(id));
    
    if (allSelected) {
      // Deselect all channels in this group
      onSelectionChange(selectedChannels.filter(id => !groupChannelIds.includes(id)));
    } else {
      // Select all channels in this group
      onSelectionChange([...new Set([...selectedChannels, ...groupChannelIds])]);
    }
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex-shrink-0 space-y-3 p-4 border-b">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Channel Selection</h3>
          <div className="flex items-center gap-1">
            <Button
              variant={activeView === 'topology' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveView('topology')}
            >
              <Grid className="h-4 w-4" />
            </Button>
            <Button
              variant={activeView === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveView('list')}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search channels (e.g., F*, C3, frontal)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Quick Presets */}
        <div className="flex flex-wrap gap-2">
          {allPresets.slice(0, 5).map((preset) => (
            <Button
              key={preset.id}
              variant="outline"
              size="sm"
              onClick={() => handlePresetSelect(preset)}
              className="text-xs"
            >
              {preset.name}
            </Button>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Bookmark className="h-3 w-3 mr-1" />
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {allPresets.slice(5).map((preset) => (
                <DropdownMenuItem
                  key={preset.id}
                  onClick={() => handlePresetSelect(preset)}
                >
                  <span className="font-medium">{preset.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {preset.description}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Selection Status */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{selectedChannels.length} of {channels.length} channels selected</span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSelectionChange([])}
              disabled={selectedChannels.length === 0}
            >
              Clear All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSelectionChange(channels.map(c => c.id))}
              disabled={selectedChannels.length === channels.length}
            >
              Select All
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        <Tabs value={activeView} className="h-full">
          <TabsContent value="topology" className="h-full m-0 p-4">
            <ChannelTopologyMap
              channels={filteredChannels}
              selectedChannels={selectedChannels}
              onChannelToggle={handleChannelToggle}
              view="2d"
            />
          </TabsContent>

          <TabsContent value="list" className="h-full m-0">
            <ScrollArea className="h-full custom-scrollbar">
              <div className="p-4 space-y-4">
                {Object.entries(channelGroups).map(([groupName, groupChannels]) => {
                  if (groupChannels.length === 0) return null;
                  
                  const group = groupName as ChannelGroup;
                  const allSelected = groupChannels.every(c => selectedChannels.includes(c.id));
                  const someSelected = groupChannels.some(c => selectedChannels.includes(c.id));
                  
                  return (
                    <div key={group} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={allSelected}
                            ref={(ref) => {
                              if (ref) {
                                (ref as any).indeterminate = someSelected && !allSelected;
                              }
                            }}
                            onCheckedChange={() => handleGroupToggle(group)}
                          />
                          <Badge className={CHANNEL_GROUP_COLORS[group]}>
                            {group.charAt(0).toUpperCase() + group.slice(1)}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            ({groupChannels.length})
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleGroupToggle(group)}
                        >
                          {allSelected ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                      
                      <div className="ml-6 space-y-1">
                        {groupChannels.map((channel) => (
                          <div
                            key={channel.id}
                            className={cn(
                              "flex items-center justify-between p-2 rounded-md hover:bg-muted/50 cursor-pointer",
                              selectedChannels.includes(channel.id) && "bg-primary/10"
                            )}
                            onClick={() => handleChannelToggle(channel.id)}
                          >
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={selectedChannels.includes(channel.id)}
                              />
                              <span className="font-medium">{channel.label}</span>
                              {!channel.active && (
                                <Badge variant="outline" className="text-xs">
                                  Inactive
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      
                      {Object.keys(channelGroups).indexOf(group) < Object.keys(channelGroups).length - 1 && (
                        <Separator />
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}