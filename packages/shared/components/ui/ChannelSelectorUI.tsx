"use client";

import { useState, useMemo } from "react";
import { Button } from "./button";
import { Spinner } from "./spinner";
import { Input } from "./input";
import { Checkbox } from "./checkbox";
import { Label } from "./label";
import { Badge } from "./badge";
import { Search, X } from "lucide-react";

interface ChannelSelectorUIProps {
  availableChannels: string[];
  selectedChannels: string[];
  onToggleChannel: (channel: string) => void;
  onSelectAllChannels: () => void;
  onClearAllChannels: () => void;
  onSelectChannels?: (channels: string[]) => void; // For selecting multiple channels at once
  isLoading?: boolean; // To show loading state for channels
  error?: Error | null; // To show error state for channels
}

export function ChannelSelectorUI({
  availableChannels,
  selectedChannels,
  onToggleChannel,
  onSelectAllChannels,
  onClearAllChannels,
  onSelectChannels,
  isLoading,
  error,
}: ChannelSelectorUIProps) {
  const [searchTerm, setSearchTerm] = useState("");

  // Filter channels based on search term
  const filteredChannels = useMemo(() => {
    if (!searchTerm.trim()) return availableChannels;
    return availableChannels.filter((channel) =>
      channel.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [availableChannels, searchTerm]);

  const clearSearch = () => {
    setSearchTerm("");
  };

  // Handle selecting all filtered channels
  const handleSelectAllFiltered = () => {
    if (onSelectChannels) {
      // Use the new callback if available
      const newSelection = [...selectedChannels];
      filteredChannels.forEach((channel) => {
        if (!newSelection.includes(channel)) {
          newSelection.push(channel);
        }
      });
      onSelectChannels(newSelection);
    } else {
      // Fallback to multiple toggle calls
      filteredChannels.forEach((channel) => {
        if (!selectedChannels.includes(channel)) {
          onToggleChannel(channel);
        }
      });
    }
  };

  return (
    <div className="space-y-3">
      {/* Header with title and selected count */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Channel Selection</h3>
        {selectedChannels.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {selectedChannels.length} selected
          </Badge>
        )}
      </div>

      {/* Search input */}
      {availableChannels.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search channels..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-9 h-9"
          />
          {searchTerm && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSearch}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 hover:bg-muted"
              title="Clear search"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {/* Action buttons */}
      {availableChannels.length > 0 && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={
              searchTerm && filteredChannels.length !== availableChannels.length
                ? handleSelectAllFiltered
                : onSelectAllChannels
            }
            className="flex-1 text-xs h-8"
            disabled={filteredChannels.length === 0}
          >
            Select All
            {searchTerm &&
              filteredChannels.length !== availableChannels.length && (
                <span className="ml-1">({filteredChannels.length})</span>
              )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onClearAllChannels}
            className="flex-1 text-xs h-8"
            disabled={selectedChannels.length === 0}
          >
            Clear All
          </Button>
        </div>
      )}

      {/* Channel list */}
      <div className="border rounded-lg bg-muted/30">
        {error ? (
          <div className="p-4 text-center">
            <p className="text-sm text-destructive">
              Error loading channels: {error.message}
            </p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Spinner />
          </div>
        ) : availableChannels.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-sm text-muted-foreground">
              No channels available
            </p>
          </div>
        ) : filteredChannels.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-sm text-muted-foreground">
              No channels match "{searchTerm}"
            </p>
          </div>
        ) : (
          <div className="max-h-[300px] overflow-y-auto">
            <div className="p-2 space-y-1">
              {filteredChannels.map((channel) => (
                <div
                  key={channel}
                  className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50 transition-colors group"
                >
                  <Checkbox
                    id={`channel-${channel}`}
                    checked={selectedChannels.includes(channel)}
                    onCheckedChange={() => onToggleChannel(channel)}
                    className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <Label
                    htmlFor={`channel-${channel}`}
                    className="flex-1 text-sm cursor-pointer font-mono group-hover:text-foreground transition-colors"
                    title={channel}
                  >
                    {channel}
                  </Label>
                  {selectedChannels.includes(channel) && (
                    <Badge variant="default" className="text-xs py-0 px-2">
                      ✓
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Search results info */}
      {searchTerm && filteredChannels.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Showing {filteredChannels.length} of {availableChannels.length}{" "}
          channels
        </p>
      )}
    </div>
  );
}
