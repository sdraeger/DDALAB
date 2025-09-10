"use client";

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, ChevronsLeft, ChevronsRight, Clock, Zap, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { TimeWindow } from '@/types/eeg';
import { cn } from '@/lib/utils';

interface TimeNavigatorProps {
  totalDuration: number;
  currentTime: number;
  chunkSize: number;
  timeWindow: TimeWindow;
  isPlaying?: boolean;
  playbackSpeed?: number;
  onTimeChange: (time: number) => void;
  onChunkSizeChange: (size: number) => void;
  onTimeWindowChange: (window: TimeWindow) => void;
  onPlayToggle?: () => void;
  onPlaybackSpeedChange?: (speed: number) => void;
  annotations?: Array<{ startTime: number; endTime?: number; label: string; color?: string }>;
  className?: string;
}

const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
const CHUNK_SIZE_PRESETS = [5, 10, 15, 30, 60]; // seconds

export function TimeNavigator({
  totalDuration,
  currentTime,
  chunkSize,
  timeWindow,
  isPlaying = false,
  playbackSpeed = 1,
  onTimeChange,
  onChunkSizeChange,
  onTimeWindowChange,
  onPlayToggle,
  onPlaybackSpeedChange,
  annotations = [],
  className
}: TimeNavigatorProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [showTimeInput, setShowTimeInput] = useState(false);
  const [timeInputValue, setTimeInputValue] = useState('');
  const scrubberRef = useRef<HTMLDivElement>(null);

  // Auto-play functionality
  useEffect(() => {
    if (!isPlaying || !onPlayToggle) return;

    const interval = setInterval(() => {
      const nextTime = currentTime + (0.1 * playbackSpeed);
      if (nextTime >= totalDuration) {
        onPlayToggle();
        onTimeChange(totalDuration);
      } else {
        onTimeChange(nextTime);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, currentTime, totalDuration, playbackSpeed, onPlayToggle, onTimeChange]);

  const formatTime = useCallback((seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0').slice(0, 1)}`;
  }, []);

  const handleScrubberClick = useCallback((event: React.MouseEvent) => {
    if (!scrubberRef.current) return;

    const rect = scrubberRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percentage * totalDuration;

    onTimeChange(newTime);
  }, [totalDuration, onTimeChange]);

  const handleTimeJump = useCallback((seconds: number) => {
    const newTime = Math.max(0, Math.min(totalDuration, currentTime + seconds));
    onTimeChange(newTime);
  }, [currentTime, totalDuration, onTimeChange]);

  const handleChunkNavigation = useCallback((direction: 'prev' | 'next' | 'first' | 'last') => {
    const chunkDuration = chunkSize;
    let newTime: number;

    switch (direction) {
      case 'first':
        newTime = 0;
        break;
      case 'prev':
        newTime = Math.max(0, currentTime - chunkDuration);
        break;
      case 'next':
        newTime = Math.min(totalDuration - chunkDuration, currentTime + chunkDuration);
        break;
      case 'last':
        newTime = Math.max(0, totalDuration - chunkDuration);
        break;
      default:
        return;
    }

    onTimeChange(newTime);
    
    // Update time window to follow the new position
    onTimeWindowChange({
      start: newTime,
      end: Math.min(totalDuration, newTime + chunkDuration),
      duration: chunkDuration
    });
  }, [chunkSize, currentTime, totalDuration, onTimeChange, onTimeWindowChange]);

  const handleTimeInputSubmit = useCallback(() => {
    const time = parseFloat(timeInputValue);
    if (!isNaN(time) && time >= 0 && time <= totalDuration) {
      onTimeChange(time);
    }
    setShowTimeInput(false);
    setTimeInputValue('');
  }, [timeInputValue, totalDuration, onTimeChange]);

  const currentChunk = Math.floor(currentTime / chunkSize) + 1;
  const totalChunks = Math.ceil(totalDuration / chunkSize);
  const progressPercentage = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className={cn("flex flex-col gap-3 p-4 bg-card border rounded-lg", className)}>
      {/* Main Controls */}
      <div className="flex items-center gap-3">
        {/* Chunk Navigation */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleChunkNavigation('first')}
            disabled={currentTime <= 0}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleChunkNavigation('prev')}
            disabled={currentTime <= 0}
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          
          {onPlayToggle && (
            <Button
              variant="outline"
              size="sm"
              onClick={onPlayToggle}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          )}
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleChunkNavigation('next')}
            disabled={currentTime >= totalDuration - chunkSize}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleChunkNavigation('last')}
            disabled={currentTime >= totalDuration - chunkSize}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-8" />

        {/* Time Display */}
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          {showTimeInput ? (
            <Input
              type="number"
              value={timeInputValue}
              onChange={(e) => setTimeInputValue(e.target.value)}
              onBlur={handleTimeInputSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTimeInputSubmit();
                if (e.key === 'Escape') {
                  setShowTimeInput(false);
                  setTimeInputValue('');
                }
              }}
              className="w-20 h-8 text-sm"
              placeholder="0.0"
              step="0.1"
              min="0"
              max={totalDuration}
              autoFocus
            />
          ) : (
            <Button
              variant="ghost"
              className="font-mono text-sm h-8 px-2"
              onClick={() => {
                setTimeInputValue(currentTime.toFixed(1));
                setShowTimeInput(true);
              }}
            >
              {formatTime(currentTime)}
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            / {formatTime(totalDuration)}
          </span>
        </div>

        <Separator orientation="vertical" className="h-8" />

        {/* Chunk Info */}
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            Chunk {currentChunk} / {totalChunks}
          </Badge>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                {chunkSize}s
                <Settings className="h-3 w-3 ml-1" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Chunk Size (seconds)</Label>
                  <div className="flex gap-1 mt-1">
                    {CHUNK_SIZE_PRESETS.map((size) => (
                      <Button
                        key={size}
                        variant={chunkSize === size ? "default" : "outline"}
                        size="sm"
                        onClick={() => onChunkSizeChange(size)}
                        className="text-xs"
                      >
                        {size}s
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <Slider
                    value={[chunkSize]}
                    onValueChange={([value]) => onChunkSizeChange(value)}
                    max={120}
                    min={1}
                    step={1}
                    className="mt-2"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>1s</span>
                    <span>120s</span>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Playback Speed */}
        {onPlaybackSpeedChange && (
          <>
            <Separator orientation="vertical" className="h-8" />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Zap className="h-3 w-3 mr-1" />
                  {playbackSpeed}x
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Playback Speed</Label>
                  <div className="grid grid-cols-3 gap-1">
                    {PLAYBACK_SPEEDS.map((speed) => (
                      <Button
                        key={speed}
                        variant={playbackSpeed === speed ? "default" : "outline"}
                        size="sm"
                        onClick={() => onPlaybackSpeedChange(speed)}
                        className="text-xs"
                      >
                        {speed}x
                      </Button>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </>
        )}
      </div>

      {/* Scrubber */}
      <div className="space-y-2">
        <div
          ref={scrubberRef}
          className="relative h-6 bg-muted rounded-md cursor-pointer overflow-hidden"
          onClick={handleScrubberClick}
        >
          {/* Progress bar */}
          <div
            className="absolute top-0 left-0 h-full bg-primary transition-all duration-150"
            style={{ width: `${progressPercentage}%` }}
          />

          {/* Time window indicator */}
          <div
            className="absolute top-0 h-full bg-primary/20 border-x-2 border-primary/40"
            style={{
              left: `${(timeWindow.start / totalDuration) * 100}%`,
              width: `${(timeWindow.duration / totalDuration) * 100}%`
            }}
          />

          {/* Annotations */}
          {annotations.map((annotation, index) => (
            <div
              key={index}
              className="absolute top-0 h-full border-l-2 opacity-70 hover:opacity-100 transition-opacity"
              style={{
                left: `${(annotation.startTime / totalDuration) * 100}%`,
                width: annotation.endTime 
                  ? `${((annotation.endTime - annotation.startTime) / totalDuration) * 100}%`
                  : '2px',
                borderColor: annotation.color || '#ef4444',
                backgroundColor: annotation.endTime ? (annotation.color || '#ef4444') + '40' : 'transparent'
              }}
              title={annotation.label}
            />
          ))}

          {/* Current position marker */}
          <div
            className="absolute top-0 w-0.5 h-full bg-foreground shadow-lg transition-all duration-150"
            style={{ left: `${progressPercentage}%` }}
          />
        </div>

        {/* Quick jump buttons */}
        <div className="flex justify-between text-xs">
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleTimeJump(-10)}
              className="text-xs h-6 px-2"
            >
              -10s
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleTimeJump(-1)}
              className="text-xs h-6 px-2"
            >
              -1s
            </Button>
          </div>
          
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleTimeJump(1)}
              className="text-xs h-6 px-2"
            >
              +1s
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleTimeJump(10)}
              className="text-xs h-6 px-2"
            >
              +10s
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}