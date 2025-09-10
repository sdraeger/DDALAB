"use client";

import React, { useMemo } from 'react';
import { EEGChannel } from '@/types/eeg';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ChannelTopologyMapProps {
  channels: EEGChannel[];
  selectedChannels: string[];
  onChannelToggle: (channelId: string) => void;
  className?: string;
  view?: '2d' | '3d';
}

// Standard 10-20 electrode positions (simplified)
const ELECTRODE_POSITIONS: Record<string, { x: number; y: number; z?: number }> = {
  // Frontal
  'Fp1': { x: -0.3, y: 0.9, z: 0.2 },
  'Fp2': { x: 0.3, y: 0.9, z: 0.2 },
  'F7': { x: -0.7, y: 0.5, z: 0.3 },
  'F3': { x: -0.4, y: 0.6, z: 0.4 },
  'Fz': { x: 0, y: 0.7, z: 0.5 },
  'F4': { x: 0.4, y: 0.6, z: 0.4 },
  'F8': { x: 0.7, y: 0.5, z: 0.3 },
  
  // Central
  'T7': { x: -0.8, y: 0, z: 0 },
  'C3': { x: -0.5, y: 0.2, z: 0.6 },
  'Cz': { x: 0, y: 0.2, z: 0.7 },
  'C4': { x: 0.5, y: 0.2, z: 0.6 },
  'T8': { x: 0.8, y: 0, z: 0 },
  
  // Parietal
  'P7': { x: -0.6, y: -0.4, z: 0.4 },
  'P3': { x: -0.3, y: -0.3, z: 0.5 },
  'Pz': { x: 0, y: -0.2, z: 0.6 },
  'P4': { x: 0.3, y: -0.3, z: 0.5 },
  'P8': { x: 0.6, y: -0.4, z: 0.4 },
  
  // Occipital
  'O1': { x: -0.2, y: -0.8, z: 0.1 },
  'Oz': { x: 0, y: -0.9, z: 0.2 },
  'O2': { x: 0.2, y: -0.8, z: 0.1 },
};

const CHANNEL_GROUP_COLORS: Record<string, string> = {
  frontal: 'bg-blue-500',
  central: 'bg-green-500',
  parietal: 'bg-yellow-500',
  occipital: 'bg-purple-500',
  temporal: 'bg-pink-500',
  other: 'bg-gray-500'
};

export function ChannelTopologyMap({
  channels,
  selectedChannels,
  onChannelToggle,
  className,
  view = '2d'
}: ChannelTopologyMapProps) {
  const enhancedChannels = useMemo(() => {
    return channels.map(channel => ({
      ...channel,
      position: channel.position || ELECTRODE_POSITIONS[channel.label]
    }));
  }, [channels]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex-1 relative w-full bg-muted/20 rounded-lg p-4">
        <svg viewBox="-1.2 -1.2 2.4 2.4" className="w-full h-full">
          {/* Head outline */}
          <circle 
            cx="0" 
            cy="0" 
            r="1" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="0.02"
            opacity="0.3"
          />
          
          {/* Nose indicator */}
          <path 
            d="M 0,-1 L -0.1,-1.2 L 0.1,-1.2 Z" 
            fill="currentColor" 
            opacity="0.3"
          />
          
          {/* Ears */}
          <circle cx="-1.1" cy="0" r="0.1" fill="none" stroke="currentColor" strokeWidth="0.02" opacity="0.3" />
          <circle cx="1.1" cy="0" r="0.1" fill="none" stroke="currentColor" strokeWidth="0.02" opacity="0.3" />
          
          {/* Channel dots */}
          {enhancedChannels.map((channel) => {
            const position = channel.position || { x: 0, y: 0 };
            const isSelected = selectedChannels.includes(channel.id);
            const group = channel.group || 'other';
            
            return (
              <g key={channel.id}>
                <circle
                  cx={position.x}
                  cy={-position.y} // Flip Y for SVG coordinates
                  r={isSelected ? 0.1 : 0.08}
                  fill={isSelected ? '#fbbf24' : channel.active ? '#3b82f6' : '#9ca3af'}
                  stroke={isSelected ? '#f59e0b' : 'transparent'}
                  strokeWidth="0.02"
                  className="cursor-pointer hover:stroke-current transition-all"
                  onClick={() => onChannelToggle(channel.id)}
                />
                <text
                  x={position.x}
                  y={-position.y + (isSelected ? 0.18 : 0.15)}
                  textAnchor="middle"
                  fontSize="0.08"
                  fill="currentColor"
                  className="pointer-events-none text-xs font-medium"
                >
                  {channel.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex-shrink-0 p-4 border-t space-y-2">
        <div className="text-sm font-medium">Channel Groups</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(CHANNEL_GROUP_COLORS).map(([group, colorClass]) => {
            const channelsInGroup = enhancedChannels.filter(c => (c.group || 'other') === group);
            if (channelsInGroup.length === 0) return null;
            
            const selectedInGroup = channelsInGroup.filter(c => selectedChannels.includes(c.id)).length;
            
            return (
              <Badge
                key={group}
                variant="outline"
                className={cn("text-xs", colorClass, "text-white")}
              >
                {group.charAt(0).toUpperCase() + group.slice(1)} ({selectedInGroup}/{channelsInGroup.length})
              </Badge>
            );
          })}
        </div>
      </div>
    </div>
  );
}